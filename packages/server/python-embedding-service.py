#!/usr/bin/env python3
"""
ONNX Embedding Service for Qilin Claw.
Supports decoder-only models like Qwen3-Embedding that require
position_ids and past_key_values in addition to input_ids / attention_mask.
"""
import sys
import io
import json
import os
import argparse
from pathlib import Path
import numpy as np

try:
    from transformers import AutoTokenizer
    import onnxruntime as ort
except ImportError as e:
    print(f"Error: Missing required packages - {e}", file=sys.stderr)
    print("Please install: pip install transformers onnxruntime numpy", file=sys.stderr)
    sys.exit(1)


class ONNXEmbeddingService:
    def __init__(self, model_path):
        self.model_path = Path(model_path)
        self.tokenizer = None
        self.session = None
        self.num_layers = 0
        self.num_heads = 0
        self.head_dim = 0
        self.needs_position_ids = False
        self.needs_past_key_values = False
        self._load_model()

    def _load_model(self):
        print(f"[Python] Loading model from: {self.model_path}", file=sys.stderr)

        # Load tokenizer
        print("[Python] Loading tokenizer...", file=sys.stderr)
        self.tokenizer = AutoTokenizer.from_pretrained(
            str(self.model_path),
            local_files_only=True
        )

        # Find ONNX model file
        onnx_files = list(self.model_path.glob("*.onnx"))
        onnx_subdir = self.model_path / "onnx"
        if onnx_subdir.exists():
            onnx_files.extend(list(onnx_subdir.glob("*.onnx")))

        if not onnx_files:
            raise FileNotFoundError(f"No ONNX model found in {self.model_path}")

        # Prefer model.onnx or model_quantized.onnx
        onnx_path = None
        for f in onnx_files:
            if f.name == "model.onnx":
                onnx_path = f
                break
            elif f.name == "model_quantized.onnx":
                onnx_path = f
                break

        if onnx_path is None:
            onnx_path = onnx_files[0]

        print(f"[Python] Loading ONNX model from: {onnx_path}", file=sys.stderr)

        # Create ONNX Runtime session
        providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
        self.session = ort.InferenceSession(str(onnx_path), providers=providers)

        # Analyze model inputs to determine what's needed
        input_names = [inp.name for inp in self.session.get_inputs()]
        self.needs_position_ids = 'position_ids' in input_names
        self.needs_past_key_values = any('past_key_values' in name for name in input_names)

        if self.needs_past_key_values:
            # Count layers and detect shape from input metadata
            kv_inputs = [inp for inp in self.session.get_inputs() if 'past_key_values' in inp.name and '.key' in inp.name]
            self.num_layers = len(kv_inputs)
            if kv_inputs:
                shape = kv_inputs[0].shape  # e.g., ['batch_size', 8, 'past_sequence_length', 128]
                self.num_heads = shape[1] if isinstance(shape[1], int) else 8
                self.head_dim = shape[3] if isinstance(shape[3], int) else 128

        print(f"[Python] Model inputs: {input_names}", file=sys.stderr)
        print(f"[Python] needs_position_ids={self.needs_position_ids}, needs_past_key_values={self.needs_past_key_values}", file=sys.stderr)
        if self.needs_past_key_values:
            print(f"[Python] KV cache: {self.num_layers} layers, {self.num_heads} heads, {self.head_dim} head_dim", file=sys.stderr)

        print("[Python] Model loaded successfully!", file=sys.stderr)

    def generate_embedding(self, text):
        if not self.tokenizer or not self.session:
            raise RuntimeError("Model not loaded")

        # Ensure text is a string
        if not isinstance(text, str):
            text = str(text)

        # Tokenize input
        inputs = self.tokenizer(
            text,
            padding=True,
            truncation=True,
            max_length=8192,
            return_tensors="np"
        )

        seq_len = inputs["input_ids"].shape[1]

        # Prepare inputs for ONNX Runtime
        ort_inputs = {
            "input_ids": inputs["input_ids"].astype(np.int64),
            "attention_mask": inputs["attention_mask"].astype(np.int64)
        }

        # Add position_ids if required
        if self.needs_position_ids:
            position_ids = np.arange(seq_len, dtype=np.int64).reshape(1, -1)
            ort_inputs["position_ids"] = position_ids

        # Add empty past_key_values if required (first-pass inference, no cached KV)
        if self.needs_past_key_values:
            for i in range(self.num_layers):
                # Shape: [batch_size, num_heads, 0, head_dim] — empty past sequence
                empty_kv = np.zeros((1, self.num_heads, 0, self.head_dim), dtype=np.float32)
                ort_inputs[f"past_key_values.{i}.key"] = empty_kv
                ort_inputs[f"past_key_values.{i}.value"] = empty_kv

        # Run inference
        outputs = self.session.run(None, ort_inputs)

        # Get last hidden state — output[0] shape: [batch, seq_len, hidden_dim]
        last_hidden_state = outputs[0]

        # For embedding models, use last-token pooling (Qwen3-Embedding style)
        # The last token's hidden state is the sentence embedding
        embedding = last_hidden_state[0, -1, :].tolist()

        # Normalize embedding to unit vector
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = (np.array(embedding) / norm).tolist()

        return embedding


def main():
    parser = argparse.ArgumentParser(description="ONNX Embedding Service")
    parser.add_argument("--model-path", required=True, help="Path to the model directory")
    args = parser.parse_args()

    try:
        service = ONNXEmbeddingService(args.model_path)

        # Ensure stdin and stdout explicitly use UTF-8 (fixes Windows CP936 issues)
        if hasattr(sys.stdin, 'buffer'):
            sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
        if hasattr(sys.stdout, 'buffer'):
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

        # Broadcast 'ready' status to parent Node.js process so it stops hanging
        print(json.dumps({"success": True, "type": "ready"}), flush=True)

        # Read input from stdin line by line
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            try:
                request = json.loads(line)
                text = request.get("text", "")

                if text:
                    embedding = service.generate_embedding(text)
                    response = {
                        "success": True,
                        "embedding": embedding,
                        "dimension": len(embedding)
                    }
                else:
                    response = {
                        "success": False,
                        "error": "No text provided"
                    }

                print(json.dumps(response, ensure_ascii=False))
                sys.stdout.flush()

            except json.JSONDecodeError as e:
                response = {
                    "success": False,
                    "error": f"Invalid JSON: {str(e)}"
                }
                print(json.dumps(response))
                sys.stdout.flush()
            except Exception as e:
                response = {
                    "success": False,
                    "error": str(e)
                }
                print(json.dumps(response))
                sys.stdout.flush()

    except Exception as e:
        print(f"[Python] Fatal error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
