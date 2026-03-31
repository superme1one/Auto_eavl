import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer


class ModelRuntime:
    def __init__(self, model_path, device, trust_remote_code):
        self.model_path = model_path
        self.device = device
        self.trust_remote_code = trust_remote_code
        self.tokenizer = None
        self.model = None
        self.runtime_device = "cpu"

    def load(self):
        self.tokenizer = AutoTokenizer.from_pretrained(
            self.model_path,
            trust_remote_code=self.trust_remote_code,
        )
        dtype = torch.float16 if torch.cuda.is_available() else torch.float32

        if self.device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA requested but torch.cuda.is_available() is False")

        if self.device == "cuda" or (self.device == "auto" and torch.cuda.is_available()):
            self.runtime_device = "cuda:0"
        else:
            self.runtime_device = "cpu"

        self.model = AutoModelForCausalLM.from_pretrained(
            self.model_path,
            trust_remote_code=self.trust_remote_code,
            torch_dtype=dtype,
            low_cpu_mem_usage=True,
        )
        self.model.to(self.runtime_device)
        self.model.eval()
        print(f"[hf_server] model loaded on {self.runtime_device}", flush=True)

    def generate(self, prompt, max_tokens, temperature, top_p, top_k):
        inputs = self.tokenizer(prompt, return_tensors="pt")
        inputs = {k: v.to(self.runtime_device) for k, v in inputs.items()}

        gen_kwargs = {
            "max_new_tokens": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "do_sample": temperature > 0,
            "pad_token_id": self.tokenizer.eos_token_id,
            "eos_token_id": self.tokenizer.eos_token_id,
        }
        if top_k is not None and int(top_k) > 0:
            gen_kwargs["top_k"] = int(top_k)

        with torch.no_grad():
            output = self.model.generate(**inputs, **gen_kwargs)

        prompt_len = inputs["input_ids"].shape[1]
        new_tokens = output[0][prompt_len:]
        return self.tokenizer.decode(new_tokens, skip_special_tokens=True)


def make_handler(runtime):
    class Handler(BaseHTTPRequestHandler):
        def _send_json(self, status, body):
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.path == "/health":
                self._send_json(200, {"ok": True, "model_path": runtime.model_path})
                return
            self._send_json(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/chat":
                self._send_json(404, {"error": "not found"})
                return

            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            try:
                body = json.loads(raw.decode("utf-8"))
                prompt = body.get("prompt", "")
                if not prompt:
                    raise ValueError("prompt is required")

                response = runtime.generate(
                    prompt=prompt,
                    max_tokens=int(body.get("max_tokens", 512)),
                    temperature=float(body.get("temperature", 0.1)),
                    top_p=float(body.get("top_p", 1.0)),
                    top_k=body.get("top_k", 1),
                )
                self._send_json(200, {"response": response})
            except Exception as exc:
                print(f"[hf_server] request failed: {exc}", flush=True)
                self._send_json(500, {"error": str(exc)})

        def log_message(self, fmt, *args):
            sys.stdout.write("[hf_server] " + fmt % args + "\n")
            sys.stdout.flush()

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18000)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--trust-remote-code", action="store_true")
    args = parser.parse_args()

    runtime = ModelRuntime(args.model_path, args.device, args.trust_remote_code)
    runtime.load()

    server = ThreadingHTTPServer((args.host, args.port), make_handler(runtime))
    print(f"[hf_server] listening on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
