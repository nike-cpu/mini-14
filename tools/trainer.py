# -*- coding: utf-8 -*-
"""mini-14 小模型训练器（NumPy 版，无需 PyTorch）。

用知识库文本训练一个字符级前馈语言模型（8 字上下文 -> 下一个字），
把训练过程以 JSON 行输出到 stdout，供 tools/train-service.mjs 读取。
"""
import argparse
import json
import os
import random
import sys
import time

import numpy as np


def log(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def load_text(kb_path, max_chars):
    with open(kb_path, encoding="utf-8") as f:
        kb = json.load(f)
    items = kb.get("items", [])
    random.Random(42).shuffle(items)
    parts, total = [], 0
    for it in items:
        t = (it.get("text") or "").strip()
        if len(t) < 60:
            continue
        parts.append(t)
        total += len(t)
        if total >= max_chars:
            break
    return "\n".join(parts)[:max_chars]


def dir_size(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def rotate_ckpt(ckpt_dir, keep=5):
    files = sorted(
        (os.path.join(ckpt_dir, f) for f in os.listdir(ckpt_dir) if f.startswith("ckpt-")),
        key=lambda x: os.path.getmtime(x),
    )
    while len(files) > keep:
        try:
            os.remove(files.pop(0))
        except OSError:
            break


def softmax(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


class Adam:
    def __init__(self, params, lr=3e-3, b1=0.9, b2=0.999, eps=1e-8):
        self.params, self.lr, self.b1, self.b2, self.eps = params, lr, b1, b2, eps
        self.m = {k: np.zeros_like(v) for k, v in params.items()}
        self.v = {k: np.zeros_like(v) for k, v in params.items()}
        self.t = 0

    def step(self, grads):
        self.t += 1
        for k, g in grads.items():
            self.m[k] = self.b1 * self.m[k] + (1 - self.b1) * g
            self.v[k] = self.b2 * self.v[k] + (1 - self.b2) * (g * g)
            mh = self.m[k] / (1 - self.b1 ** self.t)
            vh = self.v[k] / (1 - self.b2 ** self.t)
            self.params[k] -= self.lr * mh / (np.sqrt(vh) + self.eps)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kb", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--steps", type=int, default=600)
    ap.add_argument("--ctx", type=int, default=8)
    ap.add_argument("--dim", type=int, default=64)
    ap.add_argument("--hidden", type=int, default=256)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--chars", type=int, default=1_000_000)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--ckpt-dir", default="")
    ap.add_argument("--ckpt-every", type=int, default=200)
    ap.add_argument("--max-gb", type=float, default=2.0)
    args = ap.parse_args()

    rng = np.random.default_rng(42)
    text = load_text(args.kb, args.chars)
    if len(text) < 20000:
        log({"type": "error", "message": "语料太少，先去资料库加点东西"})
        return

    counts = {}
    for ch in text:
        counts[ch] = counts.get(ch, 0) + 1
    vocab = sorted(counts, key=lambda c: -counts[c])[:6000]
    stoi = {c: i for i, c in enumerate(vocab)}
    itos = {i: c for c, i in stoi.items()}
    unk = len(vocab)
    data = np.array([stoi.get(c, unk) for c in text], dtype=np.int32)

    V, C, D, H = len(vocab) + 1, args.ctx, args.dim, args.hidden
    params = {
        "E": rng.normal(0, 0.1, (V, D)).astype(np.float32),
        "W1": rng.normal(0, np.sqrt(2.0 / (C * D)), (C * D, H)).astype(np.float32),
        "b1": np.zeros(H, dtype=np.float32),
        "W2": rng.normal(0, np.sqrt(2.0 / H), (H, V)).astype(np.float32),
        "b2": np.zeros(V, dtype=np.float32),
    }
    resumed_from = None
    if args.resume and os.path.exists(args.out):
        try:
            blob = np.load(args.out, allow_pickle=True)
            loaded_vocab = [str(c) for c in blob["vocab"]]
            if loaded_vocab == vocab:
                for k in params:
                    if k in blob:
                        v = blob[k]
                        if v.shape == params[k].shape:
                            params[k] = np.array(v, dtype=np.float32)
                resumed_from = args.out
        except Exception:
            resumed_from = None
    nparams = sum(p.size for p in params.values())
    storage = os.path.dirname(os.path.abspath(args.out))
    used = dir_size(storage) if os.path.isdir(storage) else 0
    log({"type": "info", "vocab": V, "chars": len(text), "params": int(nparams),
         "resumed": bool(resumed_from), "storage_mb": round(used / 1e6, 1),
         "budget_gb": args.max_gb})

    opt = Adam(params, lr=args.lr)
    t0 = time.time()
    running = []
    n = len(data) - C - 1

    for step in range(1, args.steps + 1):
        idx = rng.integers(0, n, size=args.batch)
        x = np.stack([data[i:i + C] for i in idx])
        y = np.array([data[i + C] for i in idx])

        emb = params["E"][x]                       # B,C,D
        flat = emb.reshape(len(idx), C * D)
        z1 = flat @ params["W1"] + params["b1"]
        h = np.tanh(z1)
        z2 = h @ params["W2"] + params["b2"]
        p = softmax(z2)

        loss = -np.log(p[np.arange(len(y)), y] + 1e-9).mean()
        running.append(float(loss))
        if len(running) > 20:
            running.pop(0)

        dz2 = p.copy()
        dz2[np.arange(len(y)), y] -= 1.0
        dz2 /= len(y)
        dW2 = h.T @ dz2
        db2 = dz2.sum(axis=0)
        dh = dz2 @ params["W2"].T
        dz1 = dh * (1.0 - h * h)
        dW1 = flat.T @ dz1
        db1 = dz1.sum(axis=0)
        dflat = (dz1 @ params["W1"].T).reshape(len(idx), C, D)
        dE = np.zeros_like(params["E"])
        np.add.at(dE, x, dflat)

        opt.step({"E": dE, "W1": dW1, "b1": db1, "W2": dW2, "b2": db2})

        if step % 10 == 0:
            log({"type": "step", "step": step, "total": args.steps,
                 "loss": round(sum(running) / len(running), 4),
                 "sec": round(time.time() - t0, 1)})

        if args.ckpt_dir and step % args.ckpt_every == 0:
            os.makedirs(args.ckpt_dir, exist_ok=True)
            ck = os.path.join(args.ckpt_dir, "ckpt-%06d.npz" % step)
            np.savez(ck, vocab=[c for c in vocab], **{k: v for k, v in params.items()})
            rotate_ckpt(args.ckpt_dir)
            used = dir_size(storage)
            if used > args.max_gb * 1e9:
                log({"type": "error", "message": "storage budget exceeded: %.1f MB" % (used / 1e6)})
                break

        if step % 100 == 0 or step == args.steps:
            prompt = text[:C] if len(text) >= C else text
            ids = [stoi.get(c, unk) for c in prompt][-C:]
            out = []
            for _ in range(60):
                xx = np.array(ids[-C:])
                e = params["E"][xx].reshape(1, C * D)
                hh = np.tanh(e @ params["W1"] + params["b1"])
                zz = hh @ params["W2"] + params["b2"]
                pp = softmax(zz / 0.8)[0]
                nxt = int(rng.choice(len(pp), p=pp))
                ids.append(nxt)
                out.append(itos.get(nxt, ""))
            log({"type": "sample", "step": step, "text": prompt + "".join(out)})

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    np.savez(args.out, vocab=[c for c in vocab], **{k: v for k, v in params.items()})
    log({"type": "done", "steps": args.steps,
         "loss": round(sum(running) / len(running), 4),
         "model": args.out, "sec": round(time.time() - t0, 1)})


if __name__ == "__main__":
    main()
