const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-api-key",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: jsonHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (path === "/health" && request.method === "GET") {
        return json({ ok: true, service: "eden-biliardo-api" });
      }

      if (path === "/players" && request.method === "GET") {
        return listPlayers(env);
      }

      if (path === "/players" && request.method === "POST") {
        await requireApiKey(request, env);
        return createPlayer(request, env);
      }

      if (path === "/matches" && request.method === "GET") {
        return listMatches(env, url);
      }

      if (path === "/matches" && request.method === "POST") {
        await requireApiKey(request, env);
        return createMatch(request, env);
      }

      if ((path === "/punteggio" || path === "/punteggi") && request.method === "GET") {
        return getStreamingScore(env);
      }

      if ((path === "/punteggio" || path === "/punteggi") && request.method === "POST") {
        await requireApiKey(request, env);
        return updateStreamingScore(request, env);
      }

      return json({ error: "Endpoint non trovato" }, 404);
    } catch (error) {
      const status = error.status || 500;
      return json({ error: error.message || "Errore interno" }, status);
    }
  },
};

async function listPlayers(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, nickname, points, played, wins, losses, draws, created_at, updated_at
     FROM players
     ORDER BY points DESC, wins DESC, played ASC, name ASC`
  ).all();

  return json({ players: results });
}

async function createPlayer(request, env) {
  const body = await readJson(request);
  const name = cleanName(body.name);
  const id = body.id || crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO players (id, name, nickname)
     VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       nickname = COALESCE(excluded.nickname, players.nickname)`
  ).bind(id, name, optionalString(body.nickname)).run();

  const player = await getPlayerByName(env, name);
  return json({ player }, 201);
}

async function listMatches(env, url) {
  const limit = clamp(Number(url.searchParams.get("limit") || 50), 1, 200);
  const { results } = await env.DB.prepare(
    `SELECT
       m.id, m.played_at, m.discipline, m.status, m.scoring_type,
       m.target_score, m.target_sets, m.max_innings,
       p1.name AS player1, p2.name AS player2, w.name AS winner,
       m.player1_score, m.player2_score, m.player1_sets, m.player2_sets,
       m.player1_innings, m.player2_innings, m.notes,
       m.created_at, m.updated_at
     FROM matches m
     JOIN players p1 ON p1.id = m.player1_id
     JOIN players p2 ON p2.id = m.player2_id
     LEFT JOIN players w ON w.id = m.winner_id
     ORDER BY m.played_at DESC, m.created_at DESC
     LIMIT ?`
  ).bind(limit).all();

  return json({ matches: results });
}

async function createMatch(request, env) {
  const body = await readJson(request);
  const player1Name = cleanName(body.player1Name || body.player1);
  const player2Name = cleanName(body.player2Name || body.player2);
  const discipline = requiredString(body.discipline, "discipline");
  const scoringType = optionalString(body.scoringType) || "sets";
  const playedAt = optionalString(body.playedAt) || new Date().toISOString();

  if (player1Name.toLocaleLowerCase() === player2Name.toLocaleLowerCase()) {
    throw httpError("I due giocatori devono essere diversi", 400);
  }

  const player1 = await ensurePlayer(env, player1Name);
  const player2 = await ensurePlayer(env, player2Name);
  const winnerName = optionalString(body.winnerName || body.winner);
  const winner = winnerName ? await ensurePlayer(env, winnerName) : null;
  const winnerId = winner ? winner.id : null;

  if (winnerId && winnerId !== player1.id && winnerId !== player2.id) {
    throw httpError("Il vincitore deve essere uno dei due giocatori", 400);
  }

  const player1Score = numberOrZero(body.player1Score);
  const player2Score = numberOrZero(body.player2Score);
  const player1Sets = numberOrZero(body.player1Sets);
  const player2Sets = numberOrZero(body.player2Sets);
  const player1Innings = numberOrZero(body.player1Innings);
  const player2Innings = numberOrZero(body.player2Innings);
  const points = calculateRankingPoints(winnerId, player1.id, player2.id, body);
  const matchId = body.id || crypto.randomUUID();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO matches (
         id, played_at, discipline, status, scoring_type,
         target_score, target_sets, max_innings,
         player1_id, player2_id, player1_score, player2_score,
         player1_sets, player2_sets, player1_innings, player2_innings,
         winner_id, notes
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      matchId,
      playedAt,
      discipline,
      optionalString(body.status) || "finished",
      scoringType,
      nullableNumber(body.targetScore),
      nullableNumber(body.targetSets),
      nullableNumber(body.maxInnings),
      player1.id,
      player2.id,
      player1Score,
      player2Score,
      player1Sets,
      player2Sets,
      player1Innings,
      player2Innings,
      winnerId,
      optionalString(body.notes)
    ),
    env.DB.prepare(
      `UPDATE players
       SET points = points + ?, played = played + 1, wins = wins + ?, losses = losses + ?, draws = draws + ?
       WHERE id = ?`
    ).bind(points.player1Points, points.player1Win, points.player1Loss, points.draw, player1.id),
    env.DB.prepare(
      `UPDATE players
       SET points = points + ?, played = played + 1, wins = wins + ?, losses = losses + ?, draws = draws + ?
       WHERE id = ?`
    ).bind(points.player2Points, points.player2Win, points.player2Loss, points.draw, player2.id),
  ]);

  return json({ matchId }, 201);
}

async function getStreamingScore(env) {
  const row = await env.DB.prepare("SELECT payload, updated_at FROM streaming_state WHERE id = ?")
    .bind("current")
    .first();

  if (!row) {
    return json({
      giocatore1: "Giocatore 1",
      giocatore2: "Giocatore 2",
      punti1: 0,
      punti2: 0,
      disciplina: "Eden del Biliardo",
      dettaglio: "Set 0 - 0",
      turno: "Giocatore 1",
      updatedAt: null,
    });
  }

  const payload = JSON.parse(row.payload);
  return json({ ...payload, updatedAt: row.updated_at });
}

async function updateStreamingScore(request, env) {
  const body = await readJson(request);
  const payload = {
    giocatore1: optionalString(body.giocatore1 || body.player1) || "Giocatore 1",
    giocatore2: optionalString(body.giocatore2 || body.player2) || "Giocatore 2",
    punti1: numberOrZero(body.punti1),
    punti2: numberOrZero(body.punti2),
    disciplina: optionalString(body.disciplina || body.discipline) || "Eden del Biliardo",
    dettaglio: optionalString(body.dettaglio || body.detail) || "Set 0 - 0",
    turno: optionalString(body.turno || body.turn) || "",
  };

  await env.DB.prepare(
    `INSERT INTO streaming_state (id, payload)
     VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`
  ).bind("current", JSON.stringify(payload)).run();

  return json({ ok: true, ...payload });
}

async function ensurePlayer(env, name) {
  const existing = await getPlayerByName(env, name);
  if (existing) {
    return existing;
  }

  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO players (id, name) VALUES (?, ?)").bind(id, name).run();
  return { id, name };
}

async function getPlayerByName(env, name) {
  return env.DB.prepare("SELECT * FROM players WHERE name = ? COLLATE NOCASE").bind(name).first();
}

function calculateRankingPoints(winnerId, player1Id, player2Id, body) {
  if (!winnerId) {
    return {
      player1Points: numberOrDefault(body.player1Points, 1),
      player2Points: numberOrDefault(body.player2Points, 1),
      player1Win: 0,
      player2Win: 0,
      player1Loss: 0,
      player2Loss: 0,
      draw: 1,
    };
  }

  const winnerPoints = numberOrDefault(body.winnerPoints, 3);
  const loserPoints = numberOrDefault(body.loserPoints, 0);
  const player1Won = winnerId === player1Id;

  return {
    player1Points: player1Won ? winnerPoints : loserPoints,
    player2Points: player1Won ? loserPoints : winnerPoints,
    player1Win: player1Won ? 1 : 0,
    player2Win: player1Won ? 0 : 1,
    player1Loss: player1Won ? 0 : 1,
    player2Loss: player1Won ? 1 : 0,
    draw: 0,
  };
}

async function requireApiKey(request, env) {
  if (!env.API_KEY) {
    return;
  }

  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const headerKey = request.headers.get("x-api-key") || "";

  if (bearer !== env.API_KEY && headerKey !== env.API_KEY) {
    throw httpError("API key mancante o non valida", 401);
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError("JSON non valido", 400);
  }
}

function cleanName(value) {
  const name = requiredString(value, "name").trim().replace(/\s+/g, " ");
  if (name.length > 80) {
    throw httpError("Nome giocatore troppo lungo", 400);
  }
  return name;
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw httpError(`Campo obbligatorio: ${field}`, 400);
  }
  return value.trim();
}

function optionalString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function nullableNumber(value) {
  return value === undefined || value === null || value === "" ? null : Number(value);
}

function numberOrZero(value) {
  return numberOrDefault(value, 0);
}

function numberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: jsonHeaders,
  });
}
