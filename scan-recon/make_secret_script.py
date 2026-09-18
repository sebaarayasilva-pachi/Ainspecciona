import os
import json

with open(r'C:\Users\DELL 7520\Downloads\ainspecciona-35a5bb95489d.json', 'r', encoding='utf-8') as f:
    content = f.read()
    
# Create a python script that will deploy the secret directly using modal API
script = f"""
import modal
import os

app = modal.App("create-secret")

@app.local_entrypoint()
def main():
    secret = modal.Secret.from_dict({{"GOOGLE_APPLICATION_CREDENTIALS_JSON": {repr(content)}}})
    # To deploy a secret, we can use modal.Secret.create_deployed
    modal.Secret.create_deployed("gcp-credentials", {{"GOOGLE_APPLICATION_CREDENTIALS_JSON": {repr(content)}}})
    print("Secret deployed successfully!")
"""

with open('deploy_secret.py', 'w', encoding='utf-8') as f:
    f.write(script)
