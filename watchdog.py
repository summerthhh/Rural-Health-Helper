import subprocess
import socket
import time
import os
import sys
import signal

APP_DIR = os.path.dirname(__file__)
HOST = '0.0.0.0'
PORTS = [8000, 8001]

# Per-port restart backoff settings
RESTART_WINDOW = 60.0  # seconds
RESTART_LIMIT = 6      # max restarts in window before backing off
BACKOFF_SLEEP = 30.0   # seconds to sleep when limit exceeded

def port_in_use(host, port, timeout=1.0):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        s.close()
        return True
    except Exception:
        try:
            s.close()
        except Exception:
            pass
        return False

def start_uvicorn(port):
    cmd = [sys.executable, '-m', 'uvicorn', 'main:app', '--host', HOST, '--port', str(port)]
    p = subprocess.Popen(cmd, cwd=APP_DIR)
    print(f"Watchdog: started {' '.join(cmd)} (pid={p.pid})")
    return p

def main_loop(pmap):
    # pmap: port -> subprocess (only processes started by this watchdog)
    last_restarts = {p: [] for p in PORTS}
    try:
        while True:
            for port in PORTS:
                our_proc = pmap.get(port)
                # if we started a proc and it's alive, nothing to do
                if our_proc and our_proc.poll() is None:
                    continue

                # if our proc exists but died, clear record
                if our_proc and our_proc.poll() is not None:
                    print(f"Watchdog: our server on port {port} died (pid={our_proc.pid}); clearing record")
                    pmap.pop(port, None)
                    our_proc = None

                occupied = port_in_use(HOST, port)
                if occupied:
                    # port is in use by someone else
                    if our_proc is None:
                        # we didn't start the running server; skip restart
                        # clear any stale restart history
                        last_restarts[port] = []
                        # nothing to do
                        continue
                    else:
                        # our_proc existed and is alive (handled above), or died (handled above)
                        pass

                # At this point: port is free and our_proc is None -> start, with backoff
                now = time.time()
                # prune old restart timestamps
                last_restarts[port] = [t for t in last_restarts[port] if now - t < RESTART_WINDOW]
                if len(last_restarts[port]) >= RESTART_LIMIT:
                    print(f"Watchdog: too many restarts for port {port} in last {RESTART_WINDOW}s; backing off {BACKOFF_SLEEP}s")
                    time.sleep(BACKOFF_SLEEP)
                    continue

                try:
                    print(f"Watchdog: starting uvicorn on port {port}")
                    proc = start_uvicorn(port)
                    pmap[port] = proc
                    last_restarts[port].append(now)
                except Exception as e:
                    print(f"Watchdog: failed to start server on {port}: {e}")
            time.sleep(3)
    except KeyboardInterrupt:
        print('Watchdog: received KeyboardInterrupt, shutting down children')
        for p in list(pmap.values()):
            try:
                p.terminate()
            except Exception:
                pass

if __name__ == '__main__':
    print('Watchdog: starting; monitoring ports:', PORTS)
    # child processes started by this watchdog
    proc_map = {}

    def _sigterm(signum, frame):
        print('Watchdog: signal received, terminating children')
        for p in list(proc_map.values()):
            try:
                p.terminate()
            except Exception:
                pass
        sys.exit(0)

    signal.signal(signal.SIGINT, _sigterm)
    signal.signal(signal.SIGTERM, _sigterm)

    main_loop(proc_map)
