#!/usr/bin/env python3
"""
gh-rest-commit.py — 纯 GitHub REST（Git Data API）多文件原子提交。

背景：部分运行环境的 git smart HTTP 端点（/info/refs?service=git-upload-pack）
会被挂起，git fetch / git push 超时；但 api.github.com 的 REST 全通。
本脚本不依赖本地 git clone 与 git 协议，直接把本地文件写进远端分支。

凭据：只从环境变量 GH_AGENT_PAT 读取，绝不写入文件、命令行、日志或报错。

用法：
  GH_AGENT_PAT=xxx python3 gh-rest-commit.py \
      --message "feat: 执行器写入通道" \
      --file scripts/gh-rest-commit.py \
      --file index.html

  # 本地路径与仓库内路径不同时，用冒号分隔：
  --file /tmp/new-index.html:index.html

  # 删除远端文件（可多次）：
  --delete scripts/old.txt

  # 只预览、不发任何写请求：
  --dry-run

  # 指定仓库 / 分支（默认 gykf123/Myself-sHTML / main）
  --repo owner/name --branch main

退出码：0 成功；非 0 失败（stdout/stderr 会给出具体 HTTP 状态与原因）。
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = 'https://api.github.com'
DEFAULT_REPO = 'gykf123/Myself-sHTML'
DEFAULT_BRANCH = 'main'
# 保活文件由站点自己的机制维护，执行器不得改动
PROTECTED = {'.keepalive-state', 'CNAME'}


def die(msg, code=1):
    print('ERROR: ' + msg, file=sys.stderr)
    sys.exit(code)


class Gh:
    def __init__(self, token, repo):
        self.token = token
        self.repo = repo

    def call(self, method, path, body=None, timeout=25):
        data = json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None
        url = f'{API}/repos/{self.repo}' + (('/' + path) if path else '')
        req = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={
                'Authorization': 'Bearer ' + self.token,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'User-Agent': 'fesui-agent-rest-commit',
                'X-GitHub-Api-Version': '2022-11-28',
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode('utf-8')
                return resp.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            raw = e.read().decode('utf-8', 'replace')
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, {'message': raw[:300]}
        except Exception as e:
            return -1, {'message': f'{type(e).__name__}: {e}'}

    def expect(self, method, path, body, wanted, what):
        st, out = self.call(method, path, body)
        if st not in wanted:
            msg = out.get('message') if isinstance(out, dict) else str(out)
            die(f'{what} 失败：HTTP {st} {msg}')
        return out


def parse_args():
    p = argparse.ArgumentParser(description='纯 REST 多文件原子提交到 GitHub 分支')
    p.add_argument('--message', required=True, help='commit message')
    p.add_argument('--file', action='append', default=[],
                   metavar='LOCAL[:REMOTE]', help='要写入的文件，可多次')
    p.add_argument('--delete', action='append', default=[],
                   metavar='REMOTE', help='要删除的远端文件，可多次')
    p.add_argument('--repo', default=DEFAULT_REPO)
    p.add_argument('--branch', default=DEFAULT_BRANCH)
    p.add_argument('--dry-run', action='store_true')
    return p.parse_args()


def normalize_remote(path):
    # 只去掉相对路径前缀 "./"，不能用 lstrip('./')：那会把 .keepalive-state
    # 这类以点号开头的文件名剥成 keepalive-state，绕过受保护名单。
    path = path.replace('\\', '/')
    while path.startswith('./'):
        path = path[2:]
    if path.startswith('/'):
        die(f'仓库内路径必须是相对路径：{path}')
    if not path or '..' in path.split('/'):
        die(f'非法仓库路径：{path}')
    if path in PROTECTED:
        die(f'拒绝改动受保护文件：{path}')
    return path


def collect(args):
    """返回 [(remote_path, bytes|None)]，None 表示删除。"""
    entries = {}
    for spec in args.file:
        if ':' in spec and not spec.startswith('/'):
            local, remote = spec.split(':', 1)
        elif ':' in spec and spec.startswith('/'):
            # 绝对路径：只有形如 /abs/path:remote 才算映射
            local, remote = spec.split(':', 1)
        else:
            local = remote = spec
        remote = normalize_remote(remote)
        if not os.path.isfile(local):
            die(f'本地文件不存在：{local}')
        with open(local, 'rb') as f:
            entries[remote] = f.read()
    for remote in args.delete:
        remote = normalize_remote(remote)
        if remote in entries:
            die(f'同一路径同时写入与删除：{remote}')
        entries[remote] = None
    if not entries:
        die('没有指定任何 --file 或 --delete')
    return sorted(entries.items())


def main():
    args = parse_args()
    token = os.environ.get('GH_AGENT_PAT', '').strip()
    if not token:
        die('缺少环境变量 GH_AGENT_PAT（凭据只从环境变量读取）')

    entries = collect(args)
    gh = Gh(token, args.repo)

    print(f'repo={args.repo} branch={args.branch}')
    for path, content in entries:
        if content is None:
            print(f'  DELETE {path}')
        else:
            print(f'  WRITE  {path}  ({len(content)} bytes)')

    if args.dry_run:
        print('DRY-RUN：未发送任何写请求。')
        return

    # 先确认 token 对该仓库确有 push 权限，避免白跑一趟
    st, repo = gh.call('GET', '')
    if st != 200:
        die(f'仓库不可读：HTTP {st} {repo.get("message", "")}')
    if not repo.get('permissions', {}).get('push'):
        die('当前 token 对该仓库没有 push 权限')

    # GitHub REST 的历史不一致：读 ref 用 /git/ref/{ref}（单数），
    # 更新 ref 用 /git/refs/{ref}（复数）。写成同一个路径会 404。
    ref_get_path = f'git/ref/heads/{args.branch}'
    ref_patch_path = f'git/refs/heads/{args.branch}'
    for attempt in range(1, 4):
        # 每次都重新取最新 base，避免并发提交造成 non-fast-forward
        base_ref = gh.expect('GET', ref_get_path, None, (200,), '读取分支 ref')
        base_sha = base_ref['object']['sha']
        base_commit = gh.expect('GET', f'git/commits/{base_sha}', None, (200,), '读取 base commit')
        base_tree = base_commit['tree']['sha']

        tree = []
        for path, content in entries:
            if content is None:
                tree.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': None})
                continue
            blob = gh.expect('POST', 'git/blobs', {
                'content': base64.b64encode(content).decode('ascii'),
                'encoding': 'base64',
            }, (201,), f'创建 blob {path}')
            tree.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})

        new_tree = gh.expect('POST', 'git/trees', {
            'base_tree': base_tree, 'tree': tree,
        }, (201,), '创建 tree')
        new_commit = gh.expect('POST', 'git/commits', {
            'message': args.message,
            'tree': new_tree['sha'],
            'parents': [base_sha],
        }, (201,), '创建 commit')

        st, out = gh.call('PATCH', ref_patch_path, {'sha': new_commit['sha'], 'force': False})
        if st == 200:
            sha = new_commit['sha']
            print(f'OK commit={sha}')
            print(f'OK url=https://github.com/{args.repo}/commit/{sha}')
            print(f'OK files={",".join(p for p, _ in entries)}')
            return
        if st in (409, 422) and attempt < 3:
            print(f'分支有并发更新（HTTP {st}），重试 {attempt}/3 …', file=sys.stderr)
            time.sleep(1.5)
            continue
        die(f'更新分支 ref 失败：HTTP {st} {out.get("message", "")}；'
            f'本地 commit 对象 {new_commit["sha"]} 已创建但未挂到分支，切勿声称已上线')


if __name__ == '__main__':
    main()
