# AI 辅助容量规划预研报告

> 版本: v2.7.6-T10 | 状态: 预研完成 | 作者: AI 助手 | 日期: 2026-08-02
> 配套文档: [v2.7.X_开发计划.md](./v2.7.X_开发计划.md)

---

## 1. 研究背景与目标

### 1.1 问题陈述

当前 AutoLink 的容量规划依赖用户手动输入 GPU 数量、收敛比目标、带宽需求等参数。对于 AI 训练场景，这些参数实际上由**训练负载特征**决定：

- **MoE 模型** (如 DeepSeek-V3, Mixtral): All-to-All 通信占比高，对 Scale-Out 带宽敏感
- **长上下文** (如 128K/1M token): Attention 计算密集，对 Scale-Up 带宽和显存敏感
- **FP8 训练**: 计算密度提升 2x，但通信量未减，对网络收敛比要求更严格

**目标**: 调研基于训练负载特征反推网络带宽与收敛比需求的可行性，为 v2.8.x 实现 AI 辅助容量规划提供技术选型。

### 1.2 用户场景

```
用户输入:
  - 模型类型: MoE / Dense
  - 模型参数量: 671B (DeepSeek-V3)
  - 上下文长度: 128K
  - 训练精度: FP8
  - 并行策略: TP=8, EP=64, PP=4
  - 目标训练规模: 1024 GPU

系统输出:
  - 推荐 Scale-Up 域大小: 72 (NVL72) 或 1024 (UALink)
  - 推荐 Scale-Out 收敛比: 1:1 (无阻塞)
  - 推荐参数网速率: 400G / 800G
  - 推荐协议: UEC / RoCEv2 / IB
  - 预估通信开销占比: 18%
  - 推荐拓扑: 3-tier Fat-Tree, 1024 GPU Pod
```

---

## 2. 技术调研

### 2.1 通信模式分析

不同训练负载的通信模式差异显著，直接影响网络设计：

| 负载类型 | 主要通信原语 | 通信占比 | 带宽敏感度 | 收敛比要求 |
|---------|------------|---------|-----------|-----------|
| **Dense LLM** (GPT-style) | AllReduce (TP), AllReduce (DP) | 15-25% | 中 | ≤ 1.5:1 |
| **MoE** (DeepSeek-V3) | All-to-All (EP), AllReduce (DP) | 30-45% | 高 | ≤ 1.2:1 |
| **长上下文** (128K+) | AllReduce (TP), P2P (PP) | 20-30% | 高 (Scale-Up) | ≤ 1.3:1 |
| **多模态** | AllReduce, AllGather | 15-20% | 中 | ≤ 1.5:1 |
| **RLHF** | AllReduce, P2P (生成+训练) | 25-35% | 高 | ≤ 1.2:1 |

### 2.2 关键公式推导

#### 2.2.1 AllReduce 通信量

标准 Ring-AllReduce 通信量：

```
C_allreduce = 2 * (N-1)/N * M
```
- N: GPU 数量
- M: 模型梯度大小 (bytes)

**带宽需求**:
```
B_required = C_allreduce / T_step
```
- T_step: 训练步长时间预算中的通信部分

#### 2.2.2 MoE All-to-All 通信量

MoE Expert Parallelism 的 All-to-All 通信：

```
C_a2a = 2 * B * S * H * sizeof(dtype)
```
- B: batch size
- S: sequence length
- H: hidden size

**收敛比影响**: All-to-All 对网络收敛比极度敏感，1.5:1 收敛比会导致 33% 的有效带宽损失。

#### 2.2.3 FP8 对网络的影响

FP8 训练:
- 计算密度: 2x (vs FP16)
- 通信量: 0.5x (梯度压缩) 或 1x (Master 权重 FP32)
- **有效通信占比提升**: 计算变快，通信占比相对提升 1.5-2x

#### 2.2.4 Scale-Up vs Scale-Out 分界

基于 NVLink/UALink 带宽对比：

```
If B_scaleup / B_scaleout > 5x:
    → 优先扩大 Scale-Up 域 (减少 Scale-Out 通信)
Else:
    → Scale-Up + Scale-Out 平衡设计
```

典型值:
- NVLink 5.0: 900 GBps vs 400G IB: 50 GBps → 比值 18x → 扩大 Scale-Up
- UALink 1.0: 200 GBps vs 400G RoCE: 50 GBps → 比值 4x → 平衡设计

### 2.3 业界参考实现

| 项目/论文 | 方法 | 输入 | 输出 | 适用性 |
|----------|------|------|------|--------|
| **DeepSpeed Estimator** | 解析模型 | 模型配置 | 通信量/显存 | ★★★★ (可直接借鉴) |
| **Megatron-LM Calculator** | 解析+经验 | 并行策略 | 通信开销 | ★★★★ |
| **NVIDIA Nsight** | 实测 | Profiling | 实际带宽 | ★★ (需运行环境) |
| **MLPerf Benchmarks** | 经验查表 | 模型+硬件 | 训练时间 | ★★★ |
| **Astra-Bench** | 模拟 | 拓扑+模型 | 通信效率 | ★★★★ |

---

## 3. 技术选型

### 3.1 推荐方案: 解析模型 + 经验规则

**核心思路**: 用户输入模型与训练配置，系统通过解析公式计算通信量，结合经验规则推荐网络参数。

```
[用户输入] → [通信量计算引擎] → [带宽需求推导] → [拓扑推荐] → [配置输出]
```

### 3.2 架构设计

```
┌─────────────────────────────────────────────────────┐
│            AI 容量规划引擎 (Python)                  │
├─────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ 模型解析器   │  │ 通信量计算器  │  │ 拓扑推荐器  │ │
│  │ (model.py)  │  │ (comm.py)    │  │ (topo.py)  │ │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘ │
│         │                │                │         │
│         └────────────────┼────────────────┘         │
│                          ▼                          │
│                 ┌────────────────┐                  │
│                 │  规则引擎       │                  │
│                 │ (rules.py)     │                  │
│                 └────────────────┘                  │
└─────────────────────────────────────────────────────┘
```

### 3.3 核心模块设计

#### 3.3.1 模型解析器 (`model_parser.py`)

```python
@dataclass
class ModelProfile:
    model_type: str          # 'dense' | 'moe' | 'multimodal'
    num_params: int          # 参数量
    hidden_size: int
    num_layers: int
    num_experts: int = 0     # MoE 专用
    context_length: int = 4096
    precision: str = 'fp16'  # 'fp8' | 'fp16' | 'bf16'
    vocab_size: int = 32000

def parse_model_config(config: dict) -> ModelProfile:
    """从用户配置解析模型档案"""
    ...
```

#### 3.3.2 通信量计算器 (`comm_calculator.py`)

```python
@dataclass
class CommRequirement:
    allreduce_bytes: int     # AllReduce 通信量
    alltoall_bytes: int      # All-to-All 通信量 (MoE)
    p2p_bytes: int           # P2P 通信量 (Pipeline)
    total_bytes: int
    comm_ratio: float        # 通信占比

def calculate_comm(
    model: ModelProfile,
    parallel: ParallelConfig,
    num_gpus: int,
) -> CommRequirement:
    """计算训练通信量"""
    ...
```

#### 3.3.3 拓扑推荐器 (`topology_recommender.py`)

```python
@dataclass
class TopologyRecommendation:
    scale_up_protocol: str   # 'NVLink' | 'UALink' | 'UB'
    scale_up_domain: int     # 推荐域大小
    scale_out_protocol: str  # 'RoCEv2' | 'IB' | 'UEC'
    scale_out_speed: str     # '400G' | '800G'
    convergence_ratio: float # 推荐收敛比
    tier_count: int          # 2 或 3 层
    estimated_comm_overhead: float  # 预估通信开销

def recommend_topology(
    comm: CommRequirement,
    target_gpus: int,
    budget: str = 'standard',  # 'economy' | 'standard' | 'premium'
) -> TopologyRecommendation:
    """基于通信需求推荐拓扑"""
    ...
```

### 3.4 规则引擎示例

```python
# 规则 1: MoE 模型必须 ≤ 1.2:1 收敛比
if model.model_type == 'moe':
    assert recommendation.convergence_ratio <= 1.2

# 规则 2: FP8 训练带宽需求 ×1.5
if model.precision == 'fp8':
    bandwidth *= 1.5

# 规则 3: 长上下文 (>32K) 优先 NVLink Scale-Up
if model.context_length > 32768:
    recommendation.scale_up_protocol = 'NVLink'

# 规则 4: >1024 GPU 自动升级为 3-tier
if target_gpus > 1024:
    recommendation.tier_count = 3
```

---

## 4. 可行性评估

### 4.1 技术可行性: ✅ 可行

- **通信量计算**: 有成熟公式 (DeepSpeed/Megatron 已验证)
- **规则推导**: 基于经验阈值，逻辑清晰
- **集成难度**: 低 (Python 模块，复用现有 designer.py)

### 4.2 数据可行性: ⚠️ 需积累

- **模型库**: 需建立常见模型 (Llama, DeepSeek, Qwen) 的预设档案
- **经验规则**: 需通过实际测试或公开 benchmark 校准
- **精度**: 解析法误差 ±15-20%，需提示用户"预估值"

### 4.3 工程可行性: ✅ 可行

- **开发量**: 约 800-1200 行 Python 代码
- **依赖**: 无新外部依赖 (纯计算)
- **测试**: 可用 DeepSpeed 公开数据验证

### 4.4 用户体验: ✅ 提升

- **当前**: 用户需手动填 8+ 参数，易出错
- **AI 辅助**: 用户选模型 + 规模，系统自动推荐，可调整

---

## 5. 实施路线图

### Phase 1: MVP (v2.8.0, 计划中)

- [ ] 实现模型解析器 (支持 Dense LLM + MoE)
- [ ] 实现 AllReduce/All-to-All 通信量计算
- [ ] 实现 5 条核心规则
- [ ] 集成到 DesignTab 作为"AI 推荐"按钮
- [ ] 预置 10 个常见模型档案 (Llama3-70B/405B, DeepSeek-V3, Qwen2.5-72B 等)

### Phase 2: 增强 (v2.8.1)

- [ ] 增加 FP8 通信量精确计算
- [ ] 增加 Pipeline Parallel 通信建模
- [ ] 增加多模态模型支持
- [ ] 增加成本估算 (基于设备库价格)

### Phase 3: 智能化 (v2.9.0)

- [ ] 接入 LLM (本地 Ollama / 云端 API) 解析自然语言需求
- [ ] 支持自定义模型配置导入 (HuggingFace config.json)
- [ ] 基于历史项目数据训练推荐模型

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|-----|------|---------|
| 通信量公式误差大 | 推荐参数不优 | 标注"预估值"，提供手动调整 |
| 模型档案不全 | 无法覆盖新模型 | 支持自定义输入，开源贡献档案 |
| 并行策略复杂 | 计算困难 | 提供 3 种预设策略 (TP/DP/PP) |
| 硬件更新快 | 规则过时 | 规则参数化，可通过配置更新 |

---

## 7. 结论

**AI 辅助容量规划技术可行**，建议在 v2.8.0 实现 MVP。

**核心价值**:
1. 降低用户专业门槛 (从填 8 参数到选 2 项)
2. 减少配置错误 (规则校验)
3. 提供量化依据 (通信量估算)

**推荐技术栈**:
- 纯 Python 解析计算 (无需 ML 框架)
- 复用现有 designer.py / validation.py 架构
- 前端新增"AI 容量规划"向导

---

## 参考资料

1. DeepSpeed: https://www.deepspeed.ai/training/
2. Megatron-LM: https://arxiv.org/abs/2104.04473
3. UALink 1.0 Spec: https://ualinkconsortium.org/
4. UEC 1.0 Spec: https://ultraethernet.org/
5. NVIDIA NVLink: https://www.nvidia.com/en-us/data-center/nvlink/
6. DeepSeek-V3 技术报告: https://arxiv.org/abs/2412.19437
7. MLPerf Training: https://mlcommons.org/benchmarks/training/
