#!/usr/bin/env python3
import os
d = r"src\assets\evo acessories"
print("exists:", os.path.isdir(d))
for f in sorted(os.listdir(d)):
    full = os.path.join(d, f)
    print(f"{'DIR ' if os.path.isdir(full) else 'FILE'}  {f}  {os.path.getsize(full)} bytes")
