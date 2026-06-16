/**
 * GitHub Pages 등 정적 호스팅용 — KOSIS API는 Worker 프록시를 경유합니다.
 * 1. workers/gemini-proxy.js 최신본 Deploy
 * 2. Worker Secrets에 KOSIS_API_KEY 설정
 * 3. 로컬만 쓸 때: proxyUrl 을 "" 로 두고 node server.mjs 실행
 */
window.KOSIS_CONFIG = {
  proxyUrl: "https://gemini-proxy.korea419.workers.dev",
};
