#!/usr/bin/env python3
import re, sys, os

def remove_comments(source):
    result = []
    i = 0
    in_string = False
    string_char = None
    in_template = False
    while i < len(source):
        if not in_string and not in_template:
            if source[i:i+2] == '//':
                while i < len(source) and source[i] != '\n':
                    i += 1
                continue
            elif source[i:i+2] == '/*':
                i += 2
                while i < len(source) - 1 and source[i:i+2] != '*/':
                    i += 1
                i += 2
                continue
            elif source[i] == '"' or source[i] == "'":
                in_string = True
                string_char = source[i]
                result.append(source[i])
                i += 1
                continue
            elif source[i] == '`':
                in_template = True
                result.append(source[i])
                i += 1
                continue
            else:
                result.append(source[i])
                i += 1
        elif in_string:
            if source[i] == '\\' and i + 1 < len(source):
                result.append(source[i])
                result.append(source[i+1])
                i += 2
                continue
            elif source[i] == string_char:
                in_string = False
                string_char = None
            result.append(source[i])
            i += 1
        elif in_template:
            if source[i] == '\\' and i + 1 < len(source):
                result.append(source[i])
                result.append(source[i+1])
                i += 2
                continue
            elif source[i] == '`':
                in_template = False
            result.append(source[i])
            i += 1
    text = ''.join(result)
    lines = text.split('\n')
    cleaned = []
    for line in lines:
        stripped = line.rstrip()
        if stripped:
            cleaned.append(stripped)
        else:
            cleaned.append('')
    return '\n'.join(cleaned)

dirs = ['/home/z/my-project/src', '/home/z/my-project/mini-services/riscv-verify']
skip_dirs = {'node_modules', '.next', 'dist', 'build'}
skip_files = {'bun.lock', 'package.json', 'tsconfig.json', 'vercel.json', 'railway.toml', 'nixpacks.toml'}
count = 0
for base_dir in dirs:
    for root, dirs_list, files in os.walk(base_dir):
        dirs_list[:] = [d for d in dirs_list if d not in skip_dirs]
        for fname in files:
            if fname in skip_files:
                continue
            if not (fname.endswith('.ts') or fname.endswith('.tsx') or fname.endswith('.js') or fname.endswith('.css')):
                continue
            fpath = os.path.join(root, fname)
            try:
                with open(fpath, 'r') as f:
                    content = f.read()
                cleaned = remove_comments(content)
                with open(fpath, 'w') as f:
                    f.write(cleaned)
                count += 1
            except Exception as e:
                print(f"Error: {fpath}: {e}")
print(f"Processed {count} files")
