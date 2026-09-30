"""一键训练全部内容域模型（多进程并行，每个进程单线程）。

沙箱/低配机器上逐个训练太慢，这里按 CPU 核数并行跑多个域。
用法：
    python scripts/train_all.py                 # 训练 configs 中登记的全部域
    python scripts/train_all.py greet qa        # 只训练指定域
    JOBS=3 python scripts/train_all.py          # 控制并行度
"""
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 域 -> (config, data 目录, 最大步数)
DOMAINS = {
    "greet": ("configs/mini_greet.json", "data/greet_processed", 800),
    "qa": ("configs/mini_qa.json", "data/qa_processed", 800),
    "enqa": ("configs/mini_enqa.json", "data/enqa_processed", 800),
    "math": ("configs/mini_math.json", "data/math_processed", 1000),
    "web": ("configs/mini_web.json", "data/web_processed", 1400),
}


def main():
    names = sys.argv[1:] or list(DOMAINS)
    # 沙箱 cgroup 内存上限 4GB：35M 参数模型在 batch16×block256 下仅注意力
    # 激活就约 2GB，单进程即 OOM。故把 batch 降到 6（RSS 约 2.3GB），串行训练。
    jobs = int(os.environ.get("JOBS", "1"))
    threads = int(os.environ.get("THREADS", "2"))
    batch = int(os.environ.get("BATCH", "6"))
    block = int(os.environ.get("BLOCK", "256"))
    logdir = os.path.join(ROOT, "checkpoints", "logs")
    os.makedirs(logdir, exist_ok=True)

    queue = list(names)
    running = {}   # name -> (proc, fh)
    t0 = time.time()

    def launch(name):
        cfg, data, steps = DOMAINS[name]
        log = open(os.path.join(logdir, name + ".log"), "w", encoding="utf-8")
        env = dict(os.environ, OMP_NUM_THREADS=str(threads), MKL_NUM_THREADS=str(threads))
        cmd = [sys.executable, "scripts/train.py", "--config", cfg, "--data-dir", data,
               "--out-dir", "checkpoints/" + name, "--threads", str(threads), "--max-steps", str(steps),
               "--block-size", str(block), "--batch-size", str(batch),
               "--eval-interval", "150", "--save-interval", "250", "--log-interval", "50"]
        print(f"[train_all] 启动 {name} (max-steps={steps})", flush=True)
        p = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        running[name] = (p, log)

    while queue or running:
        while queue and len(running) < jobs:
            launch(queue.pop(0))
        time.sleep(5)
        for name, (p, log) in list(running.items()):
            if p.poll() is not None:
                log.close()
                print(f"[train_all] {name} 结束，exit={p.returncode} "
                      f"({(time.time()-t0)/60:.1f} min)", flush=True)
                del running[name]

    print(f"[train_all] 全部完成，用时 {(time.time()-t0)/60:.1f} min", flush=True)


if __name__ == "__main__":
    main()