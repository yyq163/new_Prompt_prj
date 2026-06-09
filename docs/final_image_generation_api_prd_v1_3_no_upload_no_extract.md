# PRD：最终版提示词优化生图 API 服务 V1.3

版本：V1.3
日期：2026-06-06
状态：已修正为“真实调用链路 + 迁移复用 ai-tu gateway 上游调用能力 + 下游直接传 references[].url + 视觉业务流程验收”
适用范围：独立部署的最终版提示词优化生图 API 服务；`ai-tu` 仓库只作为可复用能力来源和下游接入参考，不直接在原仓库上硬改。
安全说明：任何私人令牌、Gitee token、上游 provider key、RAGFlow key、图床 key 都不得写入 PRD、代码、示例请求、截图、日志或 trace；只能通过本地环境变量、部署密钥或安全配置注入。

---

## 0. 本次关键修正

本版对 V1.3 做以下硬修正：

1. **不要 Mock。**最终业务验收、端到端测试、视觉点击测试必须走真实调用链路。
2. **真实上游 provider 调用能力直接复用 `ai-tu` gateway。**不是重新写一套 provider，而是把 `ai-tu` gateway 中已经存在的上游请求、provider 配置、鉴权、错误处理、超时处理、响应字段映射等能力复制出来，迁移进最终 API 服务，改造成 Provider Adapter。
3. **不是直接改原 `ai-tu` 仓库。**`ai-tu` 原项目不是最终服务的施工地基；它是可复用代码来源、下游接入参考、真实业务流程参考。
4. **迁移，不是重写，但只迁移真正需要的上游调用能力。**下游已经通过 `references[].url` 传入参考图 URL，最终 API 服务不负责参考图上传，不迁移 `uploadReferenceToImgbb` / multipart 上传能力；生成结果也优先使用上游 provider 返回的图片 URL，不迁移独立“图片提取能力”，只做 provider 响应字段映射与结果标准化。
5. **最终 API 服务自己承载主链路。**最终服务内部完成 `references[]` 校验、实体绑定、防串图、RAGFlow enhancement、Prompt Compiler 编译、真实 provider 调用、图片结果返回。
6. **视觉验收要基于真实前端页面。**不是只改请求体，不是 curl，不是脚本直调；要通过可见页面点击、输入 prompt、填写参考图 URL、选择 role/usage、提交，走真实业务流程。
7. **视觉验收前端可以是最终服务自带测试控制台，也可以是从 `ai-tu` 前端复制迁移出来的独立测试台。**但原则上不直接污染原 `ai-tu` 仓库。

---

## 1. 项目关系重新定义

### 1.1 最终版 API 服务是什么

最终版提示词优化生图系统是一个**独立部署、对外开放 API 的后端服务**。

它对外提供统一接口，例如：

```http
POST /api/v1/image-generations
```

它负责：

1. 接收下游传入的 `task_type`、`prompt`、`references[]`、`output`、`callback_url`。
2. 校验请求体。
3. 抽取 `[实体名]` / `@实体名`。
4. 生成 `mention_id`。
5. 根据 `references[]` 做实体绑定。
6. 校验 `reference_id` 唯一性。
7. 校验同一 `entity_name + role` 多张图时必须有 `primary / auxiliary`。
8. 执行 `reference_policy`。
9. 可选调用 RAGFlow / LLM 获取结构化 enhancement。
10. 由后端 Prompt Compiler 确定性生成内部 `final_prompt`。
11. 通过迁移自 `ai-tu` gateway 的真实 provider 能力调用上游生图。
12. 接收上游返回的图片 URL 并标准化为 `images[]` 返回；当前不承担参考图上传、图床转存或图片提取管线。
13. 返回对下游安全的响应体。
14. 内部保存 trace/log。

### 1.2 `ai-tu` 项目是什么

`ai-tu` 项目当前不是最终 API 服务的施工目标，不要直接在原项目上硬改主链路。

`ai-tu` 在本方案中的定位是三件事：

1. **上游 provider 调用能力来源**：复制迁移 `ai-tu` gateway 中已有的上游请求、provider 配置、鉴权、错误处理、超时处理和响应字段映射能力。
2. **下游接入参考**：它可以作为未来外部下游如何调用最终 API 的样例。
3. **真实业务流程参考**：它的前端交互、参考图输入、提交生图等流程可以作为最终服务测试控制台的参考。当前最终 API 接收的是参考图 URL，不要求最终服务接管文件上传。

重点：

> 本次不是“直接改 ai-tu”。本次是“把 ai-tu gateway 的真实上游能力复制出来，移植到最终版 API 服务的 Provider Adapter 中”。

### 1.3 为什么要迁移而不是重写

因为 `ai-tu` gateway 已经有真实上游调用经验，不应该重新造一套。

应复用的能力包括：

1. 上游请求封装。
2. provider 配置 / 鉴权 / 请求头 / 超时处理。
3. 请求 payload 构造和字段映射。
4. 上游响应状态判断。
5. 上游返回图片 URL 的字段映射与结果标准化。
6. 错误返回和失败处理。
7. provider 配置经验。

明确不迁移：

1. 参考图上传 / 图床上传能力。下游必须直接传 `references[].url`。
2. multipart 文件上传能力。最终 API 当前只接收 JSON 请求体。
3. 独立图片提取管线。当前以 provider 返回的图片 URL 为准，只做响应字段映射。若个别 provider 只返回 base64，后续作为 provider-specific adapter 单独处理，不作为当前通用迁移项。

迁移策略：

```text
ai-tu gateway 原始能力
↓ 复制
最终 API 服务 provider adapter 模块
↓ 改造成最终版内部调用接口
真实上游 provider
```

---

## 2. 当前版本明确不做

当前版本不做以下事情：

1. 不走项目资产库。
2. 不做 `project_asset_lookup`。
3. 不通过 `structured_input` / `asset_id` 绑定资产。
4. 不把 `asset_id` 作为当前图片绑定入口。
5. 不让 RAGFlow / LLM 决定图片绑定。
6. 不让 RAGFlow / LLM 生成最终提示词。
7. 不让 RAGFlow / LLM 新增 reference。
8. 不返回 `final_prompt`。
9. 不返回 `final_prompt_preview`。
10. 不向下游暴露 RAGFlow 失败、fallback、本地模板兜底等内部细节。
11. 不在后端写死 `storyboard_input_type` 枚举。
12. 不让下游传 `storyboard_input_type`。
13. 不使用 Mock provider 作为业务验收结果。
14. 不用 fake image URL 冒充成功生成。
15. 不直接在原 `ai-tu` 仓库上大改最终主链路。
16. 不重新写一套已经能从 `ai-tu` gateway 迁移的上游 provider 调用能力。

真实参考图来源只有：

```text
references[]
```

真实图片生成必须走：

```text
Prompt Compiler 内部 final_prompt
+
validated references
+
迁移后的真实 provider adapter
+
真实上游 provider
```

---

## 3. 总体架构

```text
外部下游 / 测试控制台
  ↓
POST /api/v1/image-generations
  ↓
Request Schema 校验
  ↓
Entity Mention Extractor
  ↓
Reference Binding / 防串图
  ↓
RAGFlow / LLM Enhancement，可选
  ↓
Prompt Compiler
  ↓
Provider Adapter，迁移自 ai-tu gateway 上游能力
  ↓
真实上游生图 provider
  ↓
图片结果提取 / 存储 / 返回
  ↓
API Response，不暴露内部 final_prompt
```

### 3.1 后端主链路

最终版 API 服务内部主链路必须自己完整闭环：

1. 接收请求。
2. 校验 schema。
3. 解析实体。
4. 绑定参考图。
5. 防串图。
6. 获取结构化增强。
7. 编译内部提示词。
8. 调真实 provider。
9. 返回图片。
10. 记录 trace。

### 3.2 Provider Adapter 来源

Provider Adapter 不从零写。

它应从 `ai-tu` gateway 中复制迁移以下能力：

1. 请求归一化逻辑。
2. 上游 provider 请求逻辑。
3. 参考图上传逻辑。
4. multipart/form-data 处理经验。
5. 上游 JSON 响应解析。
6. 图片数组提取。
7. 错误处理。
8. provider 配置读取。

迁移后形成最终服务内部模块，例如：

```text
src/image_generation/providers/ai_tu_provider_adapter.ts
或
src/prompt_proj/image_api/providers/ai_tu_provider_adapter.py
```

具体语言可按最终服务技术栈确定。当前原则是：

> 能复制迁移就复制迁移，不要重新实现一套与 ai-tu gateway 重复的上游调用代码。

---

## 4. 支持的任务类型

当前固定 6 种 `task_type`：

```ts
type ImageTaskType =
  | "text_image"
  | "image_reference"
  | "character_multiview"
  | "scene_multiview"
  | "prop_multiview"
  | "storyboard";
```

| task_type | 中文名 | 最终交付物 |
|---|---|---|
| `text_image` | 文生图 | 普通文字生图 |
| `image_reference` | 普通图生图 | 基于参考图生成新图 |
| `character_multiview` | 人物多视角图 | 角色四视图 / 角色设定图 / 人物一致性参考图 |
| `scene_multiview` | 场景多视图图 | 场景多机位 / 空间关系 / 现场光影 / 氛围参考板 |
| `prop_multiview` | 道具多视图图 | 道具结构 / 材质 / 纹样 / 多角度资产图 |
| `storyboard` | 故事板 | 剧情宫格电影分镜制作板 |

核心原则：

> `task_type` 按最终交付物划分，不按 prompt 中出现人物、场景还是道具来硬限制。

例如：

```text
生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图
```

它应该归入：

```text
task_type = scene_multiview
```

因为最终交付物是现场光影 / 场景多视图参考板，不是人物四视图。

---

## 5. references[] 协议

`references[]` 是当前唯一真实参考图来源。

```json
{
  "reference_id": "ref_char_xzn_001",
  "entity_name": "萧昭宁",
  "entity_type": "character",
  "role": "character_reference",
  "usage": "auxiliary",
  "url": "https://cdn.example.com/xzn.png",
  "mime_type": "image/png",
  "display_name": "萧昭宁.png",
  "description": "萧昭宁角色参考图",
  "order": 1
}
```

字段说明：

| 字段 | 含义 |
|---|---|
| `reference_id` | 本次请求里的参考图唯一 ID |
| `entity_name` | 实体名，用来匹配 `[实体名]` / `@实体名` |
| `entity_type` | 实体类型，例如 character / scene / prop / outfit / style |
| `role` | 参考图用途 |
| `usage` | 主参考或辅助参考：`primary` / `auxiliary` |
| `url` | 真实图片地址 |
| `mime_type` | 图片类型 |
| `display_name` | 前端展示名 |
| `description` | 图片说明 |
| `order` | 上传顺序 |

---

## 6. role 枚举和中文名

```ts
type ReferenceRole =
  | "face_reference"
  | "character_reference"
  | "outfit_reference"
  | "hair_reference"
  | "prop_reference"
  | "scene_reference"
  | "style_reference"
  | "composition_reference"
  | "lighting_reference"
  | "material_reference"
  | "ornament_reference"
  | "storyboard_reference";
```

| role | 中文名 |
|---|---|
| `face_reference` | 人物脸部参考图 |
| `character_reference` | 角色参考图 |
| `outfit_reference` | 服装 / 造型参考图 |
| `hair_reference` | 发型参考图 |
| `prop_reference` | 道具参考图 |
| `scene_reference` | 场景参考图 |
| `style_reference` | 风格参考图 |
| `composition_reference` | 构图参考图 |
| `lighting_reference` | 光影参考图 |
| `material_reference` | 材质参考图 |
| `ornament_reference` | 纹样 / 装饰参考图 |
| `storyboard_reference` | 故事板参考图 |

---

## 7. 实体标记协议

所有任务支持两种标记方式。

### 7.1 方括号标记

```text
[萧昭宁]
[营帐]
[沙盘]
[木杆]
[女将军铠甲]
[花朝节溪边场景]
[古风金属纹样]
```

### 7.2 @ mention 标记

```text
@萧昭宁
@营帐
@沙盘
@木杆
@女将军铠甲
@花朝节溪边场景
@古风金属纹样
```

含义：

```text
这是 prompt 中需要被识别、绑定或增强的实体 / 参考对象。
```

它们不等于图片。图片必须来自 `references[]`。

---

## 8. ID 体系

| 字段 | 谁生成 | 作用 |
|---|---|---|
| `request_id` | 下游 | 标识一次请求，用于幂等和追踪 |
| `generation_id` | 后端 | 标识一次生图任务 |
| `reference_id` | 下游或后端 | 标识本次请求中的某张参考图 |
| `mention_id` | 后端 | 标识 prompt 中某个实体出现位置 |
| `template_id` | 后端模板 / RAGFlow 增强结果 | 标识模板版本 |
| `image_id` | 后端 | 标识返回给下游的生成图 |
| `trace_id` | 后端 | 内部排查、日志、链路追踪 |

固定规则：

```text
reference_id 管图片。
mention_id 管 prompt 里的实体出现位置。
template_id 管模板版本，不参与图片绑定。
generation_id 管生图任务。
image_id 管返回图片。
trace_id 管排查链路。
```

---

## 9. 主参考 / 辅助参考规则

```ts
type ReferenceUsage = "primary" | "auxiliary";
```

主参考示例：

```json
{
  "reference_id": "ref_scene_camp_001",
  "entity_name": "营帐",
  "role": "scene_reference",
  "usage": "primary",
  "url": "https://cdn.example.com/camp.png"
}
```

辅助参考示例：

```json
{
  "reference_id": "ref_char_xzn_001",
  "entity_name": "萧昭宁",
  "role": "character_reference",
  "usage": "auxiliary",
  "url": "https://cdn.example.com/xzn.png"
}
```

默认规则：

```text
如果同一 entity_name + role 只有一张图：默认 primary。
如果同一 entity_name + role 有多张图：必须显式标记 primary / auxiliary。
```

否则阻断。

错误返回：

```json
{
  "status": "failed",
  "error_code": "DUPLICATE_ENTITY_ROLE_REFERENCE",
  "message": "「萧昭宁」存在多张角色参考图，请指定一张主参考图，或将其他图片标记为辅助参考图。"
}
```

---

## 10. 任务类型不按实体硬限制

废掉这种规则：

```text
场景多视图图不能有人物参考图。
人物多视角图不能有场景参考图。
道具多视图图不能有角色参考图。
```

正确规则：

```text
人物、场景、道具、服装、风格、光影、构图都可以混合引用。
task_type 只决定最终输出板式和主目标。
```

真正要控制的是：

```text
谁是主参考。
谁是辅助参考。
最终交付物是什么。
```

---

## 11. 各任务主辅参考规则

### 11.1 text_image

最终交付物：普通文字生图。

默认不需要 `references[]`。

如果传了参考图，返回：

```json
{
  "status": "failed",
  "error_code": "REFERENCES_NOT_ALLOWED",
  "message": "文生图任务不需要上传参考图。如果需要使用参考图，请选择普通图生图或对应的多视图任务。"
}
```

### 11.2 image_reference

最终交付物：基于参考图生成新图，不限定为专项设定板。

允许混合参考，不强制主参考类型。

### 11.3 character_multiview

最终交付物：人物四视图 / 角色设定图 / 角色一致性参考图。

建议至少有一个主参考：

```text
人物脸部参考图
或
角色参考图
```

允许辅助参考：服装、发型、场景、道具、风格、构图、光影、材质、纹样。

### 11.4 scene_multiview

最终交付物：场景空间、现场光影、现场调度、多机位参考板。

建议至少有一个主参考：

```text
场景参考图
或
光影参考图
或
构图参考图
```

允许辅助参考：角色、人物脸部、道具、风格、材质、纹样。

示例：

```text
生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图
```

应为：

```text
@营帐 → 场景参考图，主参考
@萧昭宁 → 角色参考图，辅助参考
```

### 11.5 prop_multiview

最终交付物：道具资产多视图 / 结构 / 材质 / 纹样参考板。

建议至少有一个主参考：

```text
道具参考图
或
材质参考图
或
纹样 / 装饰参考图
```

允许辅助参考：角色、人物脸部、场景、风格、构图、光影。

### 11.6 storyboard

最终交付物：剧情宫格电影分镜制作板。

故事板天然是混合型，允许角色、人物脸部、场景、道具、风格、构图、光影、材质、纹样、故事板参考图。

故事板可以纯文本生成，不强制参考图。

---

## 12. API 请求体

示例：

```json
{
  "request_id": "req_20260606_001",
  "task_type": "scene_multiview",
  "prompt": "生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图。",
  "references": [
    {
      "reference_id": "ref_char_xzn_001",
      "entity_name": "萧昭宁",
      "entity_type": "character",
      "role": "character_reference",
      "usage": "auxiliary",
      "url": "https://cdn.example.com/xzn.png",
      "mime_type": "image/png",
      "display_name": "萧昭宁.png",
      "description": "萧昭宁角色参考图",
      "order": 1
    },
    {
      "reference_id": "ref_scene_camp_001",
      "entity_name": "营帐",
      "entity_type": "scene",
      "role": "scene_reference",
      "usage": "primary",
      "url": "https://cdn.example.com/camp.png",
      "mime_type": "image/png",
      "display_name": "营帐.png",
      "description": "营帐场景参考图",
      "order": 2
    }
  ],
  "reference_policy": {
    "unbound_entity": "warn",
    "duplicate_entity_role": "block"
  },
  "output": {
    "count": 1,
    "aspect_ratio": "16:9",
    "quality": "high",
    "return_format": "url",
    "language": "zh-CN"
  },
  "options": {
    "board_style": "lineart"
  },
  "callback_url": "https://client.example.com/callback"
}
```

---

## 13. 后端 normalized_request

后端解析请求后生成内部标准结构。

```json
{
  "request_id": "req_20260606_001",
  "task_type": "scene_multiview",
  "task_type_label": "场景多视图图",
  "generation_mode": "image_to_image",
  "input": {
    "prompt": "生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图。"
  },
  "entity_mentions": [
    {
      "mention_id": "m_001",
      "marker": "@萧昭宁",
      "entity_name": "萧昭宁",
      "reference_status": "bound",
      "matched_reference_ids": ["ref_char_xzn_001"]
    },
    {
      "mention_id": "m_002",
      "marker": "@营帐",
      "entity_name": "营帐",
      "reference_status": "bound",
      "matched_reference_ids": ["ref_scene_camp_001"]
    }
  ],
  "resolved_references": [
    {
      "reference_id": "ref_char_xzn_001",
      "entity_name": "萧昭宁",
      "role": "character_reference",
      "role_label": "角色参考图",
      "usage": "auxiliary",
      "url": "https://cdn.example.com/xzn.png"
    },
    {
      "reference_id": "ref_scene_camp_001",
      "entity_name": "营帐",
      "role": "scene_reference",
      "role_label": "场景参考图",
      "usage": "primary",
      "url": "https://cdn.example.com/camp.png"
    }
  ]
}
```

---

## 14. RAGFlow / LLM 定位

RAGFlow / LLM 只做可选结构化增强。

它可以输出：

```json
{
  "status": "ok",
  "template_id": "scene_multiview_v1",
  "enhancement": {
    "scene_summary": "萧昭宁位于营帐内部，营帐作为主空间，人物作为现场光影与比例锚点。",
    "visual_focus": "营帐空间、现场光影、人物在场景中的位置关系。",
    "lighting_notes": "营帐内形成局部暖光，人物边缘有柔和轮廓光。",
    "composition_notes": "多机位展示人物与营帐空间的关系。",
    "negative_notes": [
      "禁止角色漂移",
      "禁止场景漂移",
      "禁止文字标签"
    ]
  }
}
```

不允许输出最终提示词：

```json
{
  "final_prompt": "..."
}
```

不允许决定：

```text
reference_id
图片 URL
图片绑定
最终 API 响应
```

RAGFlow / LLM 失败、超时、输出非法 JSON、输出越权 reference、内容质量差时，后端丢弃 enhancement，用原始 prompt + 本地模板继续编译并调用真实上游 provider。

对下游不返回：

```text
RAGFlow 失败
fallback
本地模板兜底
内部提示词增强失败
```

---

## 15. Prompt Compiler

最终内部 `final_prompt` 只能由后端 Prompt Compiler 生成。

输入：

```text
normalized_request
entity_mentions
resolved_references
RAGFlow enhancement，可选
本地模板
负向规则
output 配置
```

输出：

```json
{
  "compiled_prompt": "内部最终生图提示词……",
  "template_id": "scene_multiview_v1",
  "references_used": [
    "ref_char_xzn_001",
    "ref_scene_camp_001"
  ]
}
```

这个输出只用于调用真实上游生图模型，不返回下游。

---

## 16. 真实 Provider Adapter 迁移需求

### 16.1 目标

最终 API 服务必须通过真实上游 provider 生成图片。

Provider Adapter 的目标不是重新造轮子，而是从 `ai-tu` gateway 复制迁移已有能力，改造成最终 API 服务内部可调用模块。

### 16.2 迁移来源

优先迁移 `ai-tu` gateway 中这些能力：

1. `normalizeImageRequest` 类逻辑：把不同来源的生图字段归一化。
2. `fetchUpstreamOnce` 类逻辑：发起真实上游 provider 请求。
3. provider 配置、鉴权、请求头、超时、错误处理经验。
4. 上游响应字段映射经验：只把 provider 返回的图片 URL 标准化为最终 API 的 `images[]`。
5. `postPromptRuntime` 类逻辑：旧链路里转发 prompt runtime 的经验可参考，但最终不照搬旧协议。
6. gateway 配置页和 provider 配置经验。

不迁移：

1. `readMultipartForm` 类文件上传逻辑。最终 API 当前只接收 JSON，请求中的参考图必须是 `references[].url`。
2. `uploadReferenceToImgbb` 类参考图上传逻辑。下游负责提供可访问图片 URL。
3. 通用 `extractImages` 图片提取能力。当前不做图片提取管线，只做 provider 响应字段映射；若实际 provider 返回结构需要轻量解析，只封装在 provider-specific adapter 内部，不作为公共迁移能力。

### 16.3 迁移后的模块职责

迁移后形成：

```text
ProviderAdapter.generate(input)
```

输入：

```json
{
  "final_prompt": "内部编译后的最终提示词",
  "negative_prompt": "内部负向提示词",
  "references": [
    {
      "reference_id": "ref_scene_camp_001",
      "url": "https://cdn.example.com/camp.png",
      "role": "scene_reference",
      "usage": "primary"
    }
  ],
  "output": {
    "count": 1,
    "aspect_ratio": "16:9",
    "quality": "high",
    "return_format": "url"
  },
  "trace_id": "trace_001"
}
```

输出：

```json
{
  "provider_request_id": "provider_req_001",
  "images": [
    {
      "url": "https://cdn.example.com/generated/xxx.png",
      "width": 1920,
      "height": 1080,
      "format": "png"
    }
  ],
  "raw_provider_status": "succeeded"
}
```

注意：这是内部 adapter 输出，不是对下游 API 响应。

### 16.4 真实调用链路要求

业务验收必须走：

```text
真实页面输入
↓
真实 API 请求
↓
真实 reference binding
↓
真实 Prompt Compiler
↓
真实 Provider Adapter
↓
真实上游 provider
↓
真实图片返回
↓
真实页面展示
```

禁止验收时使用：

```text
Mock provider
fake image url
固定图片占位返回
跳过上游调用的 succeeded
脚本直接写入数据库
curl 代替视觉页面流程
后端日志代替页面结果
```

---

## 17. 故事板处理：三条执行路径

当：

```text
task_type = storyboard
```

后端不写死 `storyboard_input_type`，也不让下游传类型。

后端只做确定性处理：

```text
prompt 非空
references[] 校验
[实体名] / @实体名 提取
实体绑定
防串图
主参考 / 辅助参考校验
```

然后把：

```text
raw_prompt
entity_mentions
resolved_references
output 配置
```

交给 RAGFlow / LLM。

RAGFlow / LLM 必须输出可执行结构化增强结果，让 Prompt Compiler 进入三条路径之一。

### 17.1 路径一：剧情 / 剧本 / 对白转分镜

适用于原始剧本、剧情段落、对白片段、场景描述、动作描述。

RAGFlow / LLM 输出：

```text
scene_summary
story_function
action_stages
shot_plan
lighting_notes
composition_notes
negative_notes
```

后端使用：

```text
raw_prompt + shot_plan + 本地故事板模板 + references_description + 负向约束
```

编译内部 `final_prompt`。

### 17.2 路径二：已有分镜 / shot 清单规范化

适用于用户已经写了镜头 1、镜头 2 或 shot 清单。

RAGFlow / LLM 必须：

```text
保留原 shot 数量
保留原 shot 顺序
保留核心动作
补景别
补运镜
补光影
补左侧规划区说明
补负向约束
```

后端使用 `normalized_shot_plan` 编译，不重拆、不重排、不合并、不删除。

### 17.3 路径三：完整故事板提示词保留增强

适用于用户已经写好完整 storyboard prompt。

RAGFlow / LLM 必须：

```text
保留原 prompt 为主体
找出缺失约束
补 references_description
补左侧规划区硬约束
补右侧剧情宫格硬约束
补负向规则
```

后端以 `raw_prompt` 为主体追加硬约束编译，不替用户重写。

### 17.4 RAGFlow 失败兜底

RAGFlow / LLM 失败时，不走三条判断路径，也不报错。

后端直接：

```text
raw_prompt + references_description + 通用故事板模板 + 负向约束
```

调用真实上游 provider。

---

## 18. 专项模板硬要求

### 18.1 character_multiview

必须是 4 格横向角色设定图：

1. 正面全身站姿。
2. 正面头部特写。
3. 侧面全身站姿。
4. 背面全身站姿。

硬要求：

```text
完整头到脚。
鞋子完整可见。
A 字站姿。
身体正直稳定。
双手自然下垂或微微张开。
手上不能持有任何道具。
头部特写只能有一个。
灰色或白色纯色背景。
棚拍式角色设计参考图。
禁止文字、字母、数字、标签、水印、UI 标识。
禁止多个头部特写。
禁止缺少侧面。
禁止缺少背面。
```

### 18.2 scene_multiview

可以是：

```text
3×3 场景多视图
现场光影多视角参考图
空间调度参考图
多机位场景板
```

重点：

```text
空间关系
现场光影
人物 / 道具在空间中的调度关系
场景氛围
镜头角度
材质细节
```

人物只作为现场比例、动作、调度和光影锚点，不改变场景多视图属性。

### 18.3 prop_multiview

重点：

```text
道具主体
结构
材质
纹样
比例
使用方式
陈设关系
```

角色 / 场景可作为比例和使用语境，不改变道具主交付物属性。

### 18.4 storyboard

故事板必须是剧情宫格电影分镜制作板。

包含：

```text
左侧规划区
右侧剧情宫格区
```

左侧包含：

1. 场景走位示意图。
2. 氛围概念图。
3. 光影变化示意。

规则：

```text
不限制 shot 数量。
不限制总时长。
不要求下游提供 structured shots[]。
右侧剧情宫格根据实际 shot 数量自适应排版。
禁止固定九宫格、四宫格、2x2、3x3。
禁止文字遮挡主体。
禁止角色漂移。
禁止场景漂移。
禁止动作顺序错误。
```

---

## 19. API 成功返回体

成功响应不返回内部提示词。

```json
{
  "request_id": "req_20260606_001",
  "generation_id": "gen_20260606_001",
  "status": "succeeded",
  "task_type": "scene_multiview",
  "task_type_label": "场景多视图图",
  "generation_mode": "image_to_image",
  "input": {
    "prompt": "生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图。",
    "task_type": "scene_multiview",
    "task_type_label": "场景多视图图"
  },
  "images": [
    {
      "image_id": "img_001",
      "url": "https://cdn.example.com/generated/scene_multiview_001.png",
      "width": 1920,
      "height": 1080,
      "format": "png"
    }
  ],
  "normalized": {
    "entity_mentions": [
      {
        "mention_id": "m_001",
        "marker": "@萧昭宁",
        "entity_name": "萧昭宁",
        "reference_status": "bound",
        "matched_reference_ids": ["ref_char_xzn_001"]
      },
      {
        "mention_id": "m_002",
        "marker": "@营帐",
        "entity_name": "营帐",
        "reference_status": "bound",
        "matched_reference_ids": ["ref_scene_camp_001"]
      }
    ],
    "references_used": [
      {
        "reference_id": "ref_char_xzn_001",
        "entity_name": "萧昭宁",
        "role_label": "角色参考图",
        "usage": "auxiliary"
      },
      {
        "reference_id": "ref_scene_camp_001",
        "entity_name": "营帐",
        "role_label": "场景参考图",
        "usage": "primary"
      }
    ]
  },
  "warnings": [],
  "trace_id": "trace_20260606_001"
}
```

不返回：

```text
final_prompt
final_prompt_preview
compiled_prompt
RAGFlow 是否失败
是否走本地模板兜底
内部 enhancement
内部 input_analysis
故事板路径判断结果
provider 原始密钥
上游原始请求体
```

---

## 20. warnings 规则

warnings 只放业务可操作信息。

可以返回：

```text
实体「木杆」未绑定道具参考图，将按文本描述生成。
实体「李将军」未绑定角色参考图，人物一致性只能依赖文本描述。
```

不要返回：

```text
RAGFlow 增强不可用，本次使用本地模板兜底。
内部提示词增强失败。
RAGFlow JSON 非法。
Prompt Compiler 使用本地模板。
```

---

## 21. 错误返回

下游请求错误直接返回中文业务错误，不做内部重试。

包括：

```text
请求体非法
task_type 缺失
task_type 不支持
prompt 为空
reference_id 重复
同一实体同一用途多张图但无主次
必要主参考缺失
图片 URL 非法
reference role 非法
```

缺少人物主参考：

```json
{
  "request_id": "req_001",
  "status": "needs_clarification",
  "task_type": "character_multiview",
  "task_type_label": "人物多视角图",
  "error_code": "REFERENCE_REQUIRED",
  "message": "人物多视角图任务缺少人物脸部参考图或角色参考图，请上传对应参考图后重新生成。",
  "trace_id": "trace_001"
}
```

上游真实 provider 失败：

```json
{
  "request_id": "req_005",
  "generation_id": "gen_005",
  "status": "failed",
  "task_type": "scene_multiview",
  "task_type_label": "场景多视图图",
  "error_code": "IMAGE_PROVIDER_CALL_FAILED",
  "message": "图片生成失败，请稍后重试。",
  "trace_id": "trace_005"
}
```

对外结果只保留：

```text
succeeded
needs_clarification
failed
```

不暴露：

```text
queued
running
fallback_running
ragflow_failed
provider_running
```

---

## 22. 视觉业务流程测试台

### 22.1 定位

视觉业务流程测试台用于真实业务验收。

它可以是：

1. 最终 API 服务自带的测试控制台。
2. 从 `ai-tu` 前端复制迁移出来的独立测试前端。
3. 不建议直接在原 `ai-tu` 仓库上硬改。

测试台必须支持真实用户流程：

1. 打开真实页面。
2. 选择 `task_type`。
3. 填写 prompt。
4. 上传参考图。
5. 为每张参考图填写 `entity_name`。
6. 选择 `role`。
7. 选择 `usage: primary / auxiliary`。
8. 设置 `reference_policy`。
9. 点击生成。
10. 页面展示真实返回图片。
11. 页面展示 warnings、generation_id、trace_id。
12. 页面不得展示 `final_prompt`、`compiled_prompt`、RAGFlow 状态、fallback、故事板路径判断。

### 22.2 视觉验收硬要求

验收必须基于真实可见浏览器页面。

必须证明：

```text
可见页面操作
→ 真实前端表单
→ 真实 API 请求
→ 真实后端校验
→ 真实 Prompt Compiler
→ 真实 Provider Adapter
→ 真实上游 provider
→ 真实图片返回
→ 页面真实渲染结果
```

禁止用以下方式替代核心验收：

```text
curl
API 脚本
后端日志
数据库查询
DOM 读取
本地文件列表
跳过页面直接调用内部函数
Mock provider
fake image url
```

允许本地命令只做：

```text
保存截图
整理报告
读取本地 manifest
写入证据文件
```

核心证据必须来自真实浏览器页面。

---

## 23. 真实调用链路验收场景

### 23.1 scene_multiview 真实链路

输入：

```text
生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图。
```

参考图：

```text
@营帐：scene_reference，primary
@萧昭宁：character_reference，auxiliary
```

验收：

1. 页面选择 `scene_multiview`。
2. 页面填写 prompt。
3. 页面填写角色图 URL 和场景图 URL。
4. 页面设置营帐为场景主参考。
5. 页面设置萧昭宁为角色辅助参考。
6. 点击生成。
7. 后端完成真实 binding。
8. 后端 Prompt Compiler 生成内部 final_prompt。
9. Provider Adapter 真实调用上游 provider。
10. 页面展示真实生成图片。
11. 页面不展示内部提示词。

### 23.2 character_multiview 真实链路

1. 页面选择 `character_multiview`。
2. 填写人物脸部 / 角色主参考图 URL。
3. 可填写服装、场景、道具辅助参考图 URL。
4. 点击生成。
5. 返回真实四视图结果。

### 23.3 prop_multiview 真实链路

1. 页面选择 `prop_multiview`。
2. 填写道具主参考图 URL。
3. 可填写角色 / 场景辅助参考图 URL。
4. 点击生成。
5. 返回真实道具多视图结果。

### 23.4 storyboard 真实链路

1. 页面选择 `storyboard`。
2. 输入剧情 / 剧本 / 对白 / 分镜 / 完整故事板提示词。
3. 可填写角色、场景、道具参考图 URL。
4. 后端不写死输入类型。
5. RAGFlow / LLM 给出三路径之一。
6. Prompt Compiler 编译内部 final_prompt。
7. Provider Adapter 真实调用上游。
8. 页面展示真实故事板图。

---

## 24. 内部 trace/log

内部记录：

```text
request_id
generation_id
trace_id
task_type
input.prompt
references[]
entity_mentions
resolved_references
primary / auxiliary 关系
RAGFlow 是否调用
RAGFlow 原始输出
RAGFlow 是否失败
enhancement 是否采纳
故事板执行路径判断
是否使用本地模板
Prompt Compiler 输入
内部 compiled_prompt / final_prompt
Provider Adapter 输入
上游 provider 响应
图片存储结果
错误堆栈
```

这些不返回给下游。

---

## 25. 施工阶段规划

### Phase 1：最终 API 协议和 schema

目标：先建立最终版 `ImageGenerationRequest / ImageGenerationResponse`，不要沿用旧 runtime 协议硬改。

交付：

1. `task_type` 枚举。
2. `references[]` schema。
3. `reference_policy`。
4. `entity_mentions`。
5. `resolved_references`。
6. 成功 / 错误响应 schema。

### Phase 2：实体抽取与 reference binding

目标：跑通 `[实体名]` / `@实体名` 抽取、`reference_id` 唯一性、主辅参考校验、防串图。

不得接 provider 之前绕过 binding。

### Phase 3：Prompt Compiler 本地模板

目标：本地模板编译六类任务内部 `final_prompt`。

注意：这一步只验证编译，不允许把 `final_prompt` 返回给下游。

### Phase 4：迁移 ai-tu gateway 真实 provider 能力

目标：复制迁移 `ai-tu` gateway 的上游能力，形成最终服务内部 Provider Adapter。

交付：

1. 迁移上游请求能力。
2. 迁移 provider 配置 / 鉴权 / 请求头 / 超时 / 错误处理能力。
3. 迁移 provider 响应字段映射能力：把上游返回的图片 URL 标准化为最终 API 的 `images[]`。
4. 明确不迁移参考图上传能力，下游必须传 `references[].url`。
5. 明确不迁移独立图片提取管线；当前以 provider 返回 URL 为准。
6. 用真实上游 provider 返回真实图片。

禁止：

```text
Mock provider
fake image url
固定成功返回
```

### Phase 5：接入 RAGFlow enhancement

目标：RAGFlow / LLM 只输出结构化 enhancement，失败时丢弃，不影响真实 provider 调用。

### Phase 6：视觉业务流程测试台

目标：建设最终服务自带测试控制台，或从 `ai-tu` 前端复制迁移成独立测试台。

重点：

```text
不是直接改原 ai-tu。
不是只改请求体。
是让测试者通过真实页面完成完整业务流。
```

### Phase 7：真实视觉点击验收

目标：使用真实浏览器页面完成六类任务真实链路测试。

必须保存：

1. 页面截图。
2. 交互步骤记录。
3. network request 证据。
4. API response 摘要。
5. 返回图片截图。
6. trace_id。

禁止用 curl / 脚本替代核心验收。

---

## 26. 测试矩阵

1. `text_image` 无 references，真实 provider 生成图片。
2. `text_image` 传 references，返回文生图不需要参考图。
3. `image_reference` 有 references，真实 provider 生成图片。
4. `character_multiview` 角色主参考，真实 provider 生成图片。
5. `character_multiview` 角色主参考 + 场景辅助参考，真实 provider 生成图片。
6. `character_multiview` 缺人物脸部参考图或角色参考图，返回中文缺图提示。
7. `scene_multiview` 场景主参考，真实 provider 生成图片。
8. `scene_multiview` 场景主参考 + 角色辅助参考，真实 provider 生成图片。
9. `scene_multiview`：生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图，真实 provider 生成图片。
10. `prop_multiview` 道具主参考，真实 provider 生成图片。
11. `prop_multiview` 道具主参考 + 角色 / 场景辅助参考，真实 provider 生成图片。
12. `storyboard` 纯剧情，无 references，真实 provider 生成图片。
13. `storyboard` 已有分镜，保留 shot 顺序和数量，真实 provider 生成图片。
14. `storyboard` 完整提示词，保留增强，真实 provider 生成图片。
15. RAGFlow 失败，后端丢弃 enhancement，仍真实调用 provider。
16. RAGFlow 输出非法 JSON，后端丢弃 enhancement，仍真实调用 provider。
17. RAGFlow 输出越权 reference_id，后端丢弃 enhancement，仍真实调用 provider。
18. `reference_id` 重复，直接返回错误。
19. 同一 `entity_name + role` 多张图无 `usage`，直接返回错误。
20. 同一 `entity_name + role` 多张图有 `primary / auxiliary`，真实 provider 生成图片。
21. `unbound_entity=warn`，未绑定实体继续生成并返回业务 warning。
22. `unbound_entity=block`，未绑定实体阻断。
23. API 成功响应不包含 `final_prompt`。
24. API 成功响应不包含 `final_prompt_preview`。
25. API 成功响应不包含 `enhancement`。
26. API 成功响应不包含 RAGFlow 状态。
27. API 成功响应不包含故事板执行路径。
28. 视觉页面选择 task_type 成功。
29. 视觉页面填写 prompt 成功。
30. 视觉页面填写参考图 URL 成功。
31. 视觉页面配置 role / usage 成功。
32. 视觉页面点击生成后展示真实图片。
33. Network 中能看到真实 API 请求。
34. 后端 trace 中能看到真实 provider 调用。
35. 上游 provider 失败时返回图片生成失败。

---

## 27. 最终验收标准

最终验收必须同时满足：

1. 最终 API 服务可独立启动。
2. `/api/v1/image-generations` 可被外部下游调用。
3. 请求体符合最终版协议。
4. `references[]` 是唯一真实参考图来源。
5. 实体标记可被抽取并绑定。
6. 防串图规则生效。
7. Prompt Compiler 由后端确定性生成内部 `final_prompt`。
8. RAGFlow / LLM 不生成最终提示词。
9. RAGFlow / LLM 不决定图片绑定。
10. Provider Adapter 由 `ai-tu` gateway 上游能力迁移而来。
11. 真实调用上游 provider 生成图片。
12. 无 Mock provider 验收。
13. API 成功响应不暴露内部提示词。
14. 视觉业务流程测试台可通过真实页面完成 prompt 输入、参考图 URL 填写、role/usage 选择、提交。
15. 视觉点击验收能看到真实图片结果。
16. 截图 / trace / network 证据完整。

---

## 28. 最终一句话

最终版系统不是直接改 `ai-tu`，也不是重新写一套上游生图能力，而是：

> **新建独立部署的最终版提示词优化生图 API 服务；把 `ai-tu` gateway 中已有的真实上游 provider 请求、配置、鉴权、错误处理和响应字段映射能力复制迁移为 Provider Adapter；参考图由下游通过 `references[].url` 直接提供，最终服务不迁移参考图上传和独立图片提取管线；通过最终服务自己的 schema、reference binding、Prompt Compiler、RAGFlow enhancement 和真实 provider 调用完成完整生图链路；视觉验收必须基于真实页面点击、输入、填写参考图 URL、选择 role/usage、提交和真实图片返回，禁止用 Mock、fake image、curl 或后端日志替代核心业务验收。**
