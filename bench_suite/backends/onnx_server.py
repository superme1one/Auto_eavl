import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import onnxruntime as ort
from optimum.onnxruntime import ORTModelForCausalLM
from transformers import AutoTokenizer


class ModelRuntime:
    def __init__(self, model_path, model_file, device, trust_remote_code):
        self.model_path = model_path
        self.model_file = model_file
        self.device = device
        self.trust_remote_code = trust_remote_code
        self.tokenizer = None
        self.model = None
        self.provider = "CPUExecutionProvider"

    def load(self):
        available = ort.get_available_providers()
        if self.device == "cuda":
            if "CUDAExecutionProvider" not in available:
                raise RuntimeError("CUDA requested for ONNX but CUDAExecutionProvider is not available")
            self.provider = "CUDAExecutionProvider"
        elif self.device == "auto" and "CUDAExecutionProvider" in available:
            self.provider = "CUDAExecutionProvider"
        else:
            self.provider = "CPUExecutionProvider"

        self.tokenizer = AutoTokenizer.from_pretrained(
            self.model_path,
            trust_remote_code=self.trust_remote_code,
        )
        self.model = ORTModelForCausalLM.from_pretrained(
            self.model_path,
            file_name=self.model_file,
            provider=self.provider,
            trust_remote_code=self.trust_remote_code,
        )
        print(f"[onnx_server] model loaded with provider={self.provider}", flush=True)

    def generate(self, prompt, max_tokens, temperature, top_p, top_k):
        inputs = self.tokenizer(prompt, return_tensors="pt")

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

        output = self.model.generate(**inputs, **gen_kwargs)
        return self.tokenizer.decode(output[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)


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
                self._send_json(200, {"ok": True, "model_path": runtime.model_path, "provider": runtime.provider})
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
                print(f"[onnx_server] request failed: {exc}", flush=True)
                self._send_json(500, {"error": str(exc)})

        def log_message(self, fmt, *args):
            sys.stdout.write("[onnx_server] " + fmt % args + "\n")
            sys.stdout.flush()

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--model-file", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18000)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--trust-remote-code", action="store_true")
    args = parser.parse_args()

    runtime = ModelRuntime(args.model_path, args.model_file, args.device, args.trust_remote_code)
    runtime.load()

    server = ThreadingHTTPServer((args.host, args.port), make_handler(runtime))
    print(f"[onnx_server] listening on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
