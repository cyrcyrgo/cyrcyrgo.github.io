import sys, time, os
import numpy as np, torch
sys.path.insert(0, "/workspace/repo/llm")
from minillm import MiniLLM, MiniLLMConfig

torch.set_num_threads(int(os.environ.get("THREADS", "1")))
for name in ["mini_greet", "mini_web"]:
    cfg = MiniLLMConfig.from_json(f"/workspace/repo/llm/configs/{name}.json")
    m = MiniLLM(cfg)
    n = m.num_parameters()
    opt = torch.optim.AdamW(m.parameters(), lr=1e-3)
    B, T = 16, 256
    x = torch.randint(0, cfg.vocab_size, (B, T))
    y = torch.randint(0, cfg.vocab_size, (B, T))
    m.train()
    # warmup
    for _ in range(1):
        logits, _ = m(x)
        loss = torch.nn.functional.cross_entropy(logits.view(-1, logits.size(-1)), y.view(-1))
        loss.backward(); opt.step(); opt.zero_grad()
    t0 = time.time()
    for _ in range(3):
        logits, _ = m(x)
        loss = torch.nn.functional.cross_entropy(logits.view(-1, logits.size(-1)), y.view(-1))
        loss.backward(); opt.step(); opt.zero_grad()
    dt = (time.time() - t0) / 3
    print(f"{name}: params {n:,} ({n*4/1024/1024:.1f}MB fp32) | {dt:.2f}s/step ({B*T/dt:.0f} tok/s) | 1000步≈{dt*1000/60:.1f}min")