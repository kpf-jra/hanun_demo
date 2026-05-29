/** POST to local server /api/hf/generate (server must be running) */
const body = {
  model: "Qwen/Qwen2.5-7B-Instruct",
  payload: {
    messages: [
      {
        role: "user",
        content:
          'JSON only: {"items":[{"id":"i1","status":"met","reason":"test"}]}',
      },
    ],
    max_tokens: 128,
    temperature: 0.1,
  },
};

const port = process.env.PORT || "3457";
const r = await fetch("http://localhost:" + port + "/api/hf/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const text = await r.text();
console.log("status", r.status);
console.log(text.slice(0, 600));
