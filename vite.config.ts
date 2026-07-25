import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn, ChildProcess } from 'child_process'

// Commander 프로세스 관리
let commanderProcess: ChildProcess | null = null;

// Commander API 플러그인
function commanderApiPlugin(): Plugin {
  return {
    name: 'commander-api',
    configureServer(server) {
      // POST /api/commander/start
      server.middlewares.use('/api/commander/start', (req, res) => {
        // CORS preflight
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.statusCode = 200;
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');

        // 이미 실행 중인지 확인
        if (commanderProcess && commanderProcess.exitCode === null) {
          res.statusCode = 409;
          res.end(JSON.stringify({ error: 'Already running', pid: commanderProcess.pid }));
          return;
        }

        // POST body 파싱
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          let options = { world: 33, llm: 'openai' };
          try {
            if (body) options = { ...options, ...JSON.parse(body) };
          } catch {}

          // 명령 구성
          const args = [
            '/home/yune/민철_UI/MobRobGPT/run_commander_ui.py',
            '--cell',
            '--world', String(options.world),
            '--ros2'
          ];

          // LLM 선택
          if (options.llm === 'openai') args.push('--openai');
          else if (options.llm === 'claude') args.push('--claude');
          else if (options.llm === 'gemini') args.push('--gemini');

          console.log(`\n[Commander] Starting: python3 ${args.join(' ')}`);

          commanderProcess = spawn('python3', args, {
            cwd: '/home/yune/민철_UI/MobRobGPT',
            stdio: ['ignore', 'pipe', 'pipe']
          });

          commanderProcess.stdout?.on('data', (data) => {
            process.stdout.write(`[Commander] ${data}`);
          });

          commanderProcess.stderr?.on('data', (data) => {
            process.stderr.write(`[Commander:ERR] ${data}`);
          });

          commanderProcess.on('close', (code) => {
            console.log(`[Commander] Exited with code ${code}`);
            commanderProcess = null;
          });

          res.statusCode = 200;
          res.end(JSON.stringify({
            success: true,
            pid: commanderProcess.pid,
            command: `python3 ${args.join(' ')}`
          }));
        });
      });

      // POST /api/commander/stop
      server.middlewares.use('/api/commander/stop', (req, res) => {
        // CORS preflight
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.statusCode = 200;
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');

        if (!commanderProcess || commanderProcess.exitCode !== null) {
          res.end(JSON.stringify({ success: true, message: 'Not running' }));
          return;
        }

        console.log(`[Commander] Stopping PID ${commanderProcess.pid}`);
        commanderProcess.kill('SIGTERM');

        // 5초 후에도 안 죽으면 강제 종료
        setTimeout(() => {
          if (commanderProcess && commanderProcess.exitCode === null) {
            commanderProcess.kill('SIGKILL');
          }
        }, 5000);

        res.end(JSON.stringify({ success: true }));
      });

      // GET /api/commander/status
      server.middlewares.use('/api/commander/status', (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');

        const running = commanderProcess !== null && commanderProcess.exitCode === null;
        res.end(JSON.stringify({
          running,
          pid: running ? commanderProcess?.pid : null
        }));
      });

      console.log('\n[Vite] Commander API enabled:');
      console.log('  POST /api/commander/start  - Start commander');
      console.log('  POST /api/commander/stop   - Stop commander');
      console.log('  GET  /api/commander/status - Check status\n');
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), commanderApiPlugin()],
  server: {
    // PORT 환경변수가 있으면 그 포트로 (프리뷰 도구가 자동 할당), 없으면 기본 5173
    port: Number(process.env.PORT) || 5173,
  },
})
