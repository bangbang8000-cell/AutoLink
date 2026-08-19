"""
AIDC 项目化（P1 A-3/A-5/A-7）：AL 侧把 AIDC 规划持久化为 workspace 下的一等"项目"。

项目目录（workspace/<name>/）：
  project.json            AL 项目元数据（含 projectId/projectName/projectType=aidc）
  project_config.json     AL 常规配置 + 顶层可选段 aidc_macro（完整宏观，兼容模板中心/健康检查/基于模板建项目）
  plan.json               最近一次 plan:table v1.2（契约 v1.2：含 projectId/planHash/planVersion）
  plan_history/v{n}.plan.json   版本快照（macro 变更时 planVersion 自增）
  output/

注：本模块为 AL 侧自包含（依赖 aidc_planner / project_config），不依赖 MC。
"""
import datetime
import json
import os
import uuid

from aidc_planner import plan_aidc
from project_config import DEFAULT_PROJECT_CONFIG


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def _read_json(path, default=None):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _project_config_with_aidc(name: str, plan: dict) -> dict:
    """AL 常规 project_config.json + 顶层可选段 aidc_macro（完整宏观）。"""
    cfg = dict(DEFAULT_PROJECT_CONFIG)
    cfg['meta'] = dict(cfg['meta'], name=name, created_at=_now(), updated_at=_now())
    cfg['topology'] = dict(cfg['topology'], num_gpu_servers=plan.get('macro', {}).get('gpuCount', 0))
    cfg['aidc_macro'] = plan.get('macro', {})
    cfg['aidc_meta'] = {k: plan.get('meta', {}).get(k)
                        for k in ('projectId', 'projectName', 'planVersion', 'planHash')}
    return cfg


def _finalize_plan(plan: dict, project_id: str, project_name: str, plan_version: int) -> dict:
    """确保 plan.meta 身份字段一致（plan_aidc 已带，这里兜底同步）。"""
    meta = plan['meta']
    meta['projectId'] = project_id
    meta['projectName'] = project_name
    meta['planVersion'] = plan_version
    return plan


def create_aidc_project(project_dir: str, name: str, macro: dict,
                        project_id: str | None = None) -> dict:
    """新建 AIDC 项目：mint projectId，写 project.json / project_config.json / plan.json / v1 快照。"""
    if not name:
        return {'error': '缺项目名'}
    if os.path.exists(project_dir):
        return {'error': f'项目目录已存在: {name}'}
    pid = project_id or str(uuid.uuid4())
    plan = plan_aidc({**(macro or {}), 'project_id': pid,
                      'project_name': name, 'plan_version': 1})
    if 'error' in plan:
        return plan
    plan = _finalize_plan(plan, pid, name, 1)
    os.makedirs(os.path.join(project_dir, 'output'), exist_ok=True)
    _write_json(os.path.join(project_dir, 'project.json'), {
        'name': name, 'projectId': pid, 'projectName': name, 'projectType': 'aidc',
        'description': '', 'createdAt': _now(), 'updatedAt': _now(), 'version': 1,
    })
    _write_json(os.path.join(project_dir, 'project_config.json'), _project_config_with_aidc(name, plan))
    _write_json(os.path.join(project_dir, 'plan.json'), plan)
    _write_json(os.path.join(project_dir, 'plan_history', 'v1.plan.json'), plan)
    return {'ok': True, 'name': name, 'projectId': pid,
            'plan': plan, 'planVersion': 1, 'changed': True}


def init_aidc_project(project_dir: str, macro: dict) -> dict:
    """打磨轮（AL-B1）：向导创建普通项目后，转 AIDC 项目——mint projectId、写 plan.json/快照、
    在 project_config.json 注入 aidc_macro、标记 projectType=aidc。幂等（已初始化则直接返回）。"""
    if not os.path.isdir(project_dir):
        return {'error': f'项目目录不存在: {project_dir}'}
    plan = _read_json(os.path.join(project_dir, 'plan.json'))
    if plan and plan.get('meta', {}).get('projectId'):
        return {'ok': True, 'name': os.path.basename(project_dir.rstrip('/')),
                'projectId': plan['meta']['projectId'], 'plan': plan,
                'planVersion': plan['meta'].get('planVersion', 1), 'changed': False}
    meta = _read_json(os.path.join(project_dir, 'project.json')) or {}
    name = meta.get('name') or os.path.basename(project_dir.rstrip('/'))
    pid = meta.get('projectId') or str(uuid.uuid4())
    plan = plan_aidc({**(macro or {}), 'project_id': pid,
                      'project_name': name, 'plan_version': 1})
    if 'error' in plan:
        return plan
    plan = _finalize_plan(plan, pid, name, 1)
    _write_json(os.path.join(project_dir, 'plan.json'), plan)
    _write_json(os.path.join(project_dir, 'plan_history', 'v1.plan.json'), plan)
    cfg = _read_json(os.path.join(project_dir, 'project_config.json')) or {}
    cfg['aidc_macro'] = plan['macro']
    cfg['aidc_meta'] = {k: plan['meta'].get(k)
                        for k in ('projectId', 'projectName', 'planVersion', 'planHash')}
    _write_json(os.path.join(project_dir, 'project_config.json'), cfg)
    meta.update({'projectId': pid, 'projectName': name, 'projectType': 'aidc',
                 'updatedAt': _now()})
    _write_json(os.path.join(project_dir, 'project.json'), meta)
    return {'ok': True, 'name': name, 'projectId': pid,
            'plan': plan, 'planVersion': 1, 'changed': True}


def save_aidc_project(project_dir: str, macro: dict) -> dict:
    """保存 AIDC 项目：重新生成；planHash 变化 → planVersion 自增 + 写历史快照。"""
    meta = _read_json(os.path.join(project_dir, 'project.json')) or {}
    name = meta.get('name') or os.path.basename(project_dir.rstrip('/'))
    pid = meta.get('projectId') or str(uuid.uuid4())
    last = _read_json(os.path.join(project_dir, 'plan.json')) or {}
    last_hash = last.get('meta', {}).get('planHash')
    last_ver = last.get('meta', {}).get('planVersion', 0) or 0
    plan = plan_aidc({**(macro or {}), 'project_id': pid,
                      'project_name': name, 'plan_version': last_ver + 1})
    if 'error' in plan:
        return plan
    changed = plan['meta']['planHash'] != last_hash
    ver = last_ver + 1 if changed else last_ver
    plan = _finalize_plan(plan, pid, name, ver)
    _write_json(os.path.join(project_dir, 'plan.json'), plan)
    _write_json(os.path.join(project_dir, 'project_config.json'), _project_config_with_aidc(name, plan))
    if changed:
        _write_json(os.path.join(project_dir, 'plan_history', f'v{ver}.plan.json'), plan)
        meta['updatedAt'] = _now()
        _write_json(os.path.join(project_dir, 'project.json'), meta)
    return {'ok': True, 'name': name, 'projectId': pid,
            'plan': plan, 'planVersion': ver, 'changed': changed}


def load_aidc_project(project_dir: str) -> dict:
    """打开 AIDC 项目：返回元数据 + 最近 plan + macro + 历史版本清单。

    健壮性（P1 A-6 模板派生项目）：
      - project.json 缺 projectId → 给本项目 mint 新身份并落盘（不沿用模板源 projectId）；
      - plan.json 缺失但 project_config.json 有 aidc_macro → 由 aidc_macro 确定性再生。
    """
    meta = _read_json(os.path.join(project_dir, 'project.json')) or {}
    if not meta.get('projectId'):
        meta['projectId'] = str(uuid.uuid4())
        meta['updatedAt'] = _now()
        _write_json(os.path.join(project_dir, 'project.json'), meta)
    pid = meta['projectId']
    plan = _read_json(os.path.join(project_dir, 'plan.json'))
    if not plan:
        cfg = _read_json(os.path.join(project_dir, 'project_config.json')) or {}
        macro = cfg.get('aidc_macro') or {}
        if macro:
            plan = plan_aidc({**macro, 'project_id': pid,
                              'project_name': meta.get('projectName', meta.get('name', '')),
                              'plan_version': 1})
        if not plan or 'error' in plan:
            return {'error': f'项目缺少 plan.json 且无法由 aidc_macro 再生: {project_dir}'}
        _write_json(os.path.join(project_dir, 'plan.json'), plan)
    # 本项目身份优先（模板派生项目不沿用源 projectId）——同步并落盘
    plan['meta']['projectId'] = pid
    plan['meta']['projectName'] = meta.get('projectName', plan['meta'].get('projectName', ''))
    _write_json(os.path.join(project_dir, 'plan.json'), plan)
    history = []
    hdir = os.path.join(project_dir, 'plan_history')
    if os.path.isdir(hdir):
        for fname in sorted(os.listdir(hdir)):
            if fname.startswith('v') and fname.endswith('.plan.json'):
                vp = _read_json(os.path.join(hdir, fname)) or {}
                vmeta = vp.get('meta', {})
                history.append({'version': vmeta.get('planVersion', 0),
                                'planHash': vmeta.get('planHash', ''),
                                'generatedAt': vmeta.get('generatedAt', '')})
    return {
        'ok': True,
        'name': meta.get('name') or os.path.basename(project_dir.rstrip('/')),
        'projectId': meta.get('projectId', plan.get('meta', {}).get('projectId', '')),
        'projectName': meta.get('projectName', plan.get('meta', {}).get('projectName', '')),
        'plan': plan,
        'macro': plan.get('macro', {}),
        'history': history,
    }


def list_aidc_projects(workspace_dir: str) -> dict:
    """列出 workspace 下所有 AIDC 项目（目录含 plan.json 即视为 AIDC 项目）。"""
    if not os.path.isdir(workspace_dir):
        return {'ok': True, 'projects': []}
    projects = []
    for name in sorted(os.listdir(workspace_dir)):
        d = os.path.join(workspace_dir, name)
        if not os.path.isdir(d) or not os.path.exists(os.path.join(d, 'plan.json')):
            continue
        meta = _read_json(os.path.join(d, 'project.json')) or {}
        plan = _read_json(os.path.join(d, 'plan.json')) or {}
        pmeta = plan.get('meta', {})
        projects.append({
            'name': name,
            'projectId': meta.get('projectId', pmeta.get('projectId', '')),
            'projectName': meta.get('projectName', pmeta.get('projectName', '')),
            'planVersion': pmeta.get('planVersion', 0),
            'updatedAt': meta.get('updatedAt', ''),
            'site': plan.get('macro', {}).get('site', ''),
            'gpuCount': plan.get('macro', {}).get('gpuCount', 0),
        })
    return {'ok': True, 'projects': projects}
