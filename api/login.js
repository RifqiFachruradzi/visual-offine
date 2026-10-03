// Vercel Function: POST /api/login {username, password} → set cookie sesi
import { handleLogin } from '../lib/session-http.js';
export default handleLogin;
