# -*- coding: utf-8 -*-
"""Score texts with the trained char-level model (lower perplexity = more in-domain).

Usage: echo '{"model":"...npz","texts":["...","..."]}' | python score.py
Output: {"ok": true, "scores": [{"ppl": 12.3, "n": 456}]}
"""
import json
import math
import sys

import numpy as np


def softmax(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def main():
    try:
        if len(sys.argv) > 1:
            with open(sys.argv[1], encoding="utf-8") as f:
                payload = json.load(f)
        else:
            payload = json.load(sys.stdin)
        model_path = payload["model"]
        texts = payload.get("texts", [])
        blob = np.load(model_path, allow_pickle=True)
        vocab = [str(c) for c in blob["vocab"]]
        stoi = {c: i for i, c in enumerate(vocab)}
        unk = len(vocab)
        E = blob["E"]
        W1, b1, W2, b2 = blob["W1"], blob["b1"], blob["W2"], blob["b2"]
        C = int(W1.shape[0] // E.shape[1])
        D = E.shape[1]
        out = []
        for text in texts:
            ids = [stoi.get(ch, unk) for ch in text[:1200]]
            if len(ids) <= C + 1:
                out.append({"ppl": None, "n": len(ids)})
                continue
            xs = np.array([ids[i:i + C] for i in range(0, len(ids) - C - 1)])
            ys = np.array(ids[C + 1:])
            total = 0.0
            for start in range(0, len(xs), 512):
                xb = xs[start:start + 512]
                yb = ys[start:start + 512]
                emb = E[xb].reshape(len(xb), C * D)
                h = np.tanh(emb @ W1 + b1)
                p = softmax(h @ W2 + b2)
                total += float(-np.log(p[np.arange(len(yb)), yb] + 1e-9).sum())
            n = len(ys)
            out.append({"ppl": round(math.exp(total / n), 3), "n": n})
        json.dump({"ok": True, "scores": out}, sys.stdout)
    except Exception as e:  # noqa: BLE001
        json.dump({"ok": False, "error": str(e)}, sys.stdout)


if __name__ == "__main__":
    main()
