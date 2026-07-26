import json, os

def make_rack_layout(num_gpu, group_size):
    cabinets = []
    cab_id = 1
    devices = []
    
    cur_u = 1
    curr_cab = {'id': cab_id, 'name': f'机柜 {chr(64+cab_id)}', 'totalU': 42, 'devices': []}
    
    # Place GPU servers (4U each)
    gpu_idx = 1
    for group in range(1, 5):
        for s in range(1, group_size + 1):
            dev = {
                'id': f'gpu-{gpu_idx}',
                'name': f'GPU服务器_{gpu_idx}',
                'type': 'GPU Server',
                'cabinetId': cab_id,
                'startU': cur_u,
                'endU': cur_u + 3
            }
            curr_cab['devices'].append(dev)
            devices.append(dev)
            gpu_idx += 1
            cur_u += 4
            if cur_u + 3 > 42:
                cabinets.append(curr_cab)
                cab_id += 1
                cur_u = 1
                curr_cab = {'id': cab_id, 'name': f'机柜 {chr(64+cab_id)}', 'totalU': 42, 'devices': []}
    
    # Storage servers (2U each)
    for s in range(1, 15):
        dev = {
            'id': f'storage-{s}',
            'name': f'存储服务器_{s}',
            'type': 'Storage Server',
            'cabinetId': cab_id,
            'startU': cur_u,
            'endU': cur_u + 1
        }
        curr_cab['devices'].append(dev)
        devices.append(dev)
        cur_u += 2
        if cur_u + 1 > 42:
            cabinets.append(curr_cab)
            cab_id += 1
            cur_u = 1
            curr_cab = {'id': cab_id, 'name': f'机柜 {chr(64+cab_id)}', 'totalU': 42, 'devices': []}
    
    # Compute servers (2U each)
    for s in range(1, 21):
        dev = {
            'id': f'compute-{s}',
            'name': f'通算服务器_{s}',
            'type': 'Compute Server',
            'cabinetId': cab_id,
            'startU': cur_u,
            'endU': cur_u + 1
        }
        curr_cab['devices'].append(dev)
        devices.append(dev)
        cur_u += 2
        if cur_u + 1 > 42:
            cabinets.append(curr_cab)
            cab_id += 1
            cur_u = 1
            curr_cab = {'id': cab_id, 'name': f'机柜 {chr(64+cab_id)}', 'totalU': 42, 'devices': []}
    
    if curr_cab['devices']:
        cabinets.append(curr_cab)
    
    return {'cabinets': cabinets, 'totalCabinets': len(cabinets), 'totalDevices': len(devices)}

if __name__ == '__main__':
    os.makedirs('demo_data', exist_ok=True)
    for name, num, gs in [('128H100', 128, 32), ('100H100', 100, 25)]:
        layout = make_rack_layout(num, gs)
        out = f'demo_data/{name}_rack_layout.json'
        with open(out, 'w', encoding='utf-8') as f:
            json.dump(layout, f, ensure_ascii=False, indent=2)
        print(f'{name}: {layout["totalCabinets"]} cabinets, {layout["totalDevices"]} devices -> {out}')
