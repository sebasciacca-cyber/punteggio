export default {
  async fetch(request) {
    return new Response("Worker attivo da GitHub!", {
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}
