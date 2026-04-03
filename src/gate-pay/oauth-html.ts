export const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OAuth Success</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; justify-content: center;
    align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
  .card { background: white; padding: 48px; border-radius: 12px; text-align: center;
    box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
  .check { font-size: 48px; margin-bottom: 16px; }
  h2 { color: #1a1a1a; margin: 0 0 8px; }
  p { color: #666; margin: 0; }
</style></head>
<body>
  <div class="card">
    <div class="check">&#10003;</div>
    <h2>Authorization Successful</h2>
    <p>You can close this tab and return to the terminal.</p>
  </div>
</body>
</html>`;

export function ERROR_HTML(msg: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OAuth Error</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; justify-content: center;
    align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
  .card { background: white; padding: 48px; border-radius: 12px; text-align: center;
    box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
  .icon { font-size: 48px; margin-bottom: 16px; }
  h2 { color: #e53e3e; margin: 0 0 8px; }
  p { color: #666; margin: 0; }
</style></head>
<body>
  <div class="card">
    <div class="icon">&#10007;</div>
    <h2>Authorization Failed</h2>
    <p>${msg}</p>
  </div>
</body>
</html>`;
}
