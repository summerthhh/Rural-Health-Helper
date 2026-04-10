import urllib.request

found = []
for p in range(8000, 8011):
    url = f'http://127.0.0.1:{p}/'
    try:
        with urllib.request.urlopen(url, timeout=1) as r:
            print(f"port {p} -> {r.getcode()}")
            found.append(p)
    except Exception:
        pass
if not found:
    print('no server responding on 8000-8010')
else:
    print('responsive ports:', found)
