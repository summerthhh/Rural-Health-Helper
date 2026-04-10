import json
import urllib.request

def post_json(url, payload):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return r.read().decode('utf-8')

if __name__ == '__main__':
    try:
        print('Signup ->')
        s = post_json('http://127.0.0.1:8000/patient/signup', {
            'first_name': 'TS', 'last_name': 'Runner', 'phone': '9990003333', 'email': 't3@example.com', 'password': 'pass3'
        })
        print(s)
    except Exception as e:
        print('signup error:', e)
    try:
        print('Login ->')
        l = post_json('http://127.0.0.1:8000/patient/login', {'phone': '9990003333', 'password': 'pass3'})
        print(l)
    except Exception as e:
        print('login error:', e)
