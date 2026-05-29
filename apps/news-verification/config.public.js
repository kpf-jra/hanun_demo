/**
 * GitHub Pages용 — 방문자가 각자 Gemini API 키를 페이지에 입력합니다.
 * (키는 Git에 올리지 않습니다.)
 *
 * CORS 때문에 Worker 프록시 URL이 필요합니다. (저장소 관리자 1회만 설정)
 * 1. workers/gemini-proxy.js → Cloudflare Workers에 배포
 * 2. 아래 proxyUrl 에 Worker 주소 입력 후 push
 *
 * 로컬만 쓸 때: proxyUrl 을 "" 로 두고 node server.mjs 실행
 */
window.NV_CONFIG = {
  proxyUrl: "https://gemini-proxy.korea419.workers.dev",
};
