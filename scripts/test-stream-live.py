import urllib.request
import json
import ssl

url = "http://127.0.0.1:3100/api/agent/stream"
payload = {
    "protocolVersion": 1,
    "model": "azure/gpt-4o",
    "messages": [
        {"id": "m1", "role": "user", "content": [{"kind": "text", "text": "Hello world"}]}
    ]
}
data = json.dumps(payload).encode("utf-8")
req = urllib.request.Request(
    url,
    data=data,
    headers={
        "Content-Type": "application/json",
        "Origin": "https://coderxp.pro",
        "Host": "coderxp.pro",
    },
)

print("=== Sending Stream Request to http://127.0.0.1:3100/api/agent/stream ===")
try:
    with urllib.request.urlopen(req) as response:
        print("HTTP Status:", response.status)
        for line in response:
            line_str = line.decode("utf-8", errors="replace").strip()
            if line_str:
                print(line_str)
except urllib.error.HTTPError as e:
    print("HTTPError:", e.code, e.read().decode("utf-8"))
except Exception as e:
    print("Error:", e)
