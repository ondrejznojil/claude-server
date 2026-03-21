const TIMEOUT_MS = 120000; // 2 minutes

async function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const proc = require('child_process').spawn('claude', ['--print', '--dangerously-skip-permissions'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    function settle(fn) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    }

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      settle(() => reject(new Error('claude timed out after 2 minutes')));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code, signal) => {
      settle(() => {
        if (code !== 0) {
          const detail = signal ? `killed by signal ${signal}` : `code ${code}: ${stderr.trim()}`;
          reject(new Error(`claude exited with ${detail}`));
        } else {
          resolve(stdout.trim());
        }
      });
    });

    proc.on('error', (err) => {
      settle(() => reject(err));
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

module.exports = { runClaude };
