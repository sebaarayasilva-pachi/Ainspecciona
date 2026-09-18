import os
import json

with open(r'C:\Users\DELL 7520\Downloads\ainspecciona-35a5bb95489d.json', 'r', encoding='utf-8') as f:
    content = f.read()

# For a .env file, we need to handle newlines.
# Or we can just write it as a single line JSON string if it's not already.
content = json.dumps(json.loads(content))

with open('gcp.env', 'w', encoding='utf-8') as f:
    f.write(f"GOOGLE_APPLICATION_CREDENTIALS_JSON='{content}'\n")
