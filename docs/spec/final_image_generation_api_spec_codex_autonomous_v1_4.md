# SPEC：最终版提示词优化生图 API 服务 V1.4-Codex 全自主执行版

版本：V1.4-SPEC-AUTO
日期：2026-06-06
执行对象：Codex / 自动化工程 Agent
执行模式：全自主执行，但必须遵守 BLOCKED 停止条件
来源 PRD：`final_image_generation_api_prd_v1_3_no_upload_no_extract.md`
修订说明：本版在 V1.3 基础上补齐 Provider Adapter 迁移边界、真实 provider 异步处理、视觉验收硬约束、RAGFlow enhancement 丢弃规则、错误映射、evidence 脱敏与 Codex BLOCKED 条件。

---

## 0. 总目标

Codex 需要在现有项目基础上实现一个**独立部署的最终版提示词优化生图 API 服务**，并提供一个**可视化业务测试台**，通过真实浏览器页面点击、输入、填写、提交，走完整真实调用链路完成验收。

最终服务不是 Mock，不是只改请求体，不是只写 API 示例，也不是直接修改 `ai-tu` 原项目。

最终真实链路必须是：

```text
可见前端页面
↓ 用户视觉点击 / 输入 / 填写 references[].url / 选择 role / usage / task_type
POST /api/v1/image-generations
↓
后端 schema 校验
↓
实体提取 [实体名] / @实体名
↓
references[] 绑定与防串图
↓
可选 RAGFlow / LLM enhancement
↓
后端 Prompt Compiler 编译内部 final_prompt
↓
迁移自 ai-tu gateway 的真实 Provider Adapter
↓
真实上游 provider
↓
真实图片 URL 返回
↓
前端展示真实生成图
↓
Codex Browser / Computer Use 视觉点击截图、trace、network evidence
```

---

## 1. 项目关系与施工边界

### 1.1 最终 API 服务

最终 API 服务是本次正式施工目标。

它对外暴露：

```http
POST /api/v1/image-generations
```

它内部负责：

1. 请求体校验。
2. `task_type` 校验。
3. `references[]` 校验。
4. `[实体名]` / `@实体名` 实体提取。
5. 参考图绑定。
6. 防串图。
7. 可选 RAGFlow / LLM enhancement。
8. 后端 Prompt Compiler 编译内部 `final_prompt`。
9. 调用真实 provider。
10. 返回标准响应。
11. 保存内部 trace。

### 1.2 ai-tu 项目

`ai-tu` 项目不是最终服务的直接施工地基，也不是本次直接修改对象。

它只承担两个角色：

1. **Provider 能力迁移来源**：从 `ai-tu gateway` 复制迁移真实上游 provider 调用能力。
2. **业务流程参考来源**：其生图器交互可以作为可视化测试台设计参考。

Codex 必须遵守：

```text
不是直接改 ai-tu。
不是 import ai-tu gateway 当运行时依赖。
不是重新写一套 provider。
是只读分析 ai-tu gateway → 输出迁移映射表 → 复制迁移必要 provider 能力到最终 API 服务内部 Provider Adapter。
```

### 1.3 ai-tu 源码路径

Codex 应优先通过本地路径读取 ai-tu 源码，例如环境变量：

```bash
AI_TU_SOURCE_PATH=/path/to/ai-tu
```

不得要求用户在聊天中提供私人令牌。不得把 Gitee token、provider key、RAGFlow key 写入代码、文档、日志、trace、截图或测试数据。

若本地没有 ai-tu 源码，Codex 必须停止并输出：

```text
BLOCKED_BY_MISSING_AI_TU_SOURCE
```

---

## 2. 硬性禁止项

Codex 不得做以下事情：

1. 不使用 Mock provider 作为业务成功验收。
2. 不使用 fake image URL 冒充成功生成。
3. 不用 curl、脚本、直接 API 调用、后端日志、DOM 读取替代核心视觉验收。
4. 不直接修改原始 `ai-tu` 仓库作为最终服务主链路。
5. 不重新写一套与 `ai-tu` gateway 重复的上游 provider 调用能力。
6. 不迁移参考图上传能力；最终 API 当前只接收 `references[].url`。
7. 不迁移 multipart 文件上传能力；当前 API 请求体为 JSON。
8. 不迁移图床上传能力，例如 `uploadReferenceToImgbb`。
9. 不迁移独立图片提取管线；当前只做 provider 响应字段映射，把上游返回的图片 URL 标准化成 `images[]`。
10. 不新增图片存储 / CDN 上传 / base64 转 URL 能力。
11. 不让 RAGFlow / LLM 生成最终 `final_prompt`。
12. 不让 RAGFlow / LLM 决定图片绑定。
13. 不让 RAGFlow / LLM 新增、修改、选择 `reference_id`。
14. 不在普通 API 响应中返回 `final_prompt`、`final_prompt_preview`、`compiled_prompt`、`enhancement`、RAGFlow 状态、fallback 状态、故事板执行路径。
15. 不在视觉验收 evidence 中泄露 `final_prompt`、provider key、Gitee token、RAGFlow key、provider internal payload。

---

## 3. 必须实现项

Codex 必须实现：

1. 独立最终 API 主链路。
2. `POST /api/v1/image-generations`。
3. JSON request schema。
4. `references[].url` 作为当前唯一真实参考图来源。
5. `generation_mode` 由 `references[]` 是否为空决定。
6. `references[]` 非空时：`image_to_image`。
7. `references[]` 为空时：`text_to_image`。
8. `[实体名]` 和 `@实体名` 作为文本实体边界，不等于已有图片。
9. 图片绑定只能由后端根据 `entity_name` 与 `references[]` 确定性完成。
10. 同一 `entity_name + role` 多张图时，必须显式 `usage: primary` / `usage: auxiliary`，否则阻断。
11. 最终内部 `final_prompt` 只能由后端 Prompt Compiler 生成。
12. RAGFlow / LLM 只作为可选结构化增强层。
13. RAGFlow / LLM 失败时，后端丢弃 enhancement，使用本地模板继续真实生图。
14. Provider Adapter 的真实 provider 调用能力必须从 `ai-tu` gateway 复制迁移。
15. 业务验收必须通过真实可见浏览器页面完成。
16. Codex 必须执行 Build → Review → Fix → Re-review 闭环，直到通过或明确 BLOCKED。

---

## 4. Provider Adapter 迁移规则

### 4.1 迁移前必须生成迁移映射表

Codex 在正式迁移代码前，必须先只读扫描 `ai-tu gateway`，输出 Provider Adapter 迁移映射表。

映射表必须包含：

```text
ai-tu 源函数 / 常量 / 配置
→ 最终 API 目标文件
→ 迁移原因
→ 是否允许迁移
→ 禁止迁移原因，如果不允许迁移
```

### 4.2 允许迁移的能力

只允许迁移以下 provider 能力：

1. Provider base URL / endpoint 配置读取。
2. Provider 鉴权 headers / auth 构造。
3. Provider 请求 payload 构造。
4. Provider HTTP 调用。
5. Provider timeout / retry / backoff。
6. Provider 错误映射。
7. Provider 同步响应中的图片 URL 字段映射。
8. Provider 异步任务 submit / poll / timeout 的内部封装。
9. Provider health check 的可复用逻辑。

### 4.3 禁止迁移的能力

不得迁移：

1. `uploadReferenceToImgbb`。
2. multipart/form-data 文件解析。
3. 图床上传。
4. 参考图文件上传。
5. 旧 UI route。
6. 旧 prompt runtime response 结构。
7. 旧接口里对外暴露 final prompt 的结构。
8. 临时 base64 转图片上传逻辑。
9. 任何私人令牌、硬编码 key、测试账号密钥。

### 4.4 不允许 import ai-tu gateway 作为运行时依赖

最终 API 服务不得运行时 import 或 require `external/ai-tu/gateway/server.js`。

正确做法：

```text
只读分析 ai-tu gateway
↓
复制迁移必要 provider 调用逻辑
↓
整理成最终 API 服务内部 Provider Adapter
↓
写测试覆盖迁移后的 Provider Adapter
```

---

## 5. Provider Adapter 异步处理规则

真实 provider 可能不是同步返回图片 URL。

若 provider 返回 `job_id` / `task_id` / `request_id` / `status_url` 等异步任务标识，Provider Adapter 必须内部封装：

```text
submit
↓
poll
↓
timeout
↓
standard images[]
```

对外 API 不得暴露：

```text
queued
running
provider_running
fallback_running
```

对外仍只返回：

```text
succeeded
needs_clarification
failed
```

### 5.1 异步成功

若 provider 在超时前返回可访问图片 URL：

```json
{
  "status": "succeeded",
  "images": [
    {
      "image_id": "img_001",
      "url": "https://provider.example.com/output.png",
      "width": 1024,
      "height": 1024,
      "format": "png"
    }
  ]
}
```

### 5.2 异步超时

若 provider 超时未返回图片 URL：

```json
{
  "status": "failed",
  "error_code": "IMAGE_PROVIDER_TIMEOUT",
  "message": "图片生成超时，请稍后重试。"
}
```

---

## 6. Provider 响应 URL 规则

当前版本只接受 provider 返回可访问图片 URL。

Provider Adapter 必须把 provider 响应标准化为：

```json
{
  "images": [
    {
      "image_id": "img_001",
      "url": "https://provider.example.com/generated.png",
      "width": 1024,
      "height": 1024,
      "format": "png"
    }
  ]
}
```

如果 provider 不返回 URL，而只返回：

```text
base64
binary
临时本地文件
需要二次上传的图片内容
```

当前版本不得临时新增上传/存储/图床逻辑，必须返回：

```json
{
  "status": "failed",
  "error_code": "PROVIDER_RESPONSE_UNSUPPORTED",
  "message": "上游返回的图片格式当前不支持，请更换支持图片 URL 返回的 provider。"
}
```

本版删除 `IMAGE_STORAGE_FAILED` 作为对外错误码。图片存储 / CDN 上传是未来扩展，不属于本次施工范围。

---

## 7. 外部 API：POST /api/v1/image-generations

### 7.1 Request Schema

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
      "url": "https://example.com/xzn.png",
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
      "url": "https://example.com/camp.png",
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
  }
}
```

当前版本不实现 `callback_url`。Codex 不得施工 callback 能力。

### 7.2 task_type

支持：

```text
text_image
image_reference
character_multiview
scene_multiview
prop_multiview
storyboard
```

任务类型按最终交付物划分，不按 prompt 里出现了人物、场景、道具来硬限制。

示例：

```text
生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图
```

应为：

```json
{
  "task_type": "scene_multiview"
}
```

其中：

```text
@营帐：scene_reference，primary
@萧昭宁：character_reference，auxiliary
```

---

## 8. Reference Binding 规则

### 8.1 reference_id 唯一

同一请求内 `reference_id` 必须唯一。

重复时返回：

```json
{
  "status": "failed",
  "error_code": "DUPLICATE_REFERENCE_ID",
  "message": "参考图 ID 重复，请检查上传的参考图。"
}
```

### 8.2 同一 entity_name + role 多图必须显式主辅

阻断示例：

```json
{
  "references": [
    {
      "reference_id": "ref_xzn_001",
      "entity_name": "萧昭宁",
      "role": "character_reference",
      "url": "https://example.com/xzn_a.png"
    },
    {
      "reference_id": "ref_xzn_002",
      "entity_name": "萧昭宁",
      "role": "character_reference",
      "url": "https://example.com/xzn_b.png"
    }
  ]
}
```

返回：

```json
{
  "status": "failed",
  "error_code": "DUPLICATE_ENTITY_ROLE_REFERENCE",
  "message": "「萧昭宁」存在多张角色参考图，请指定一张主参考图，或将其他图片标记为辅助参考图。"
}
```

正确写法：

```json
{
  "references": [
    {
      "reference_id": "ref_xzn_main",
      "entity_name": "萧昭宁",
      "role": "character_reference",
      "usage": "primary",
      "url": "https://example.com/xzn_main.png"
    },
    {
      "reference_id": "ref_xzn_side",
      "entity_name": "萧昭宁",
      "role": "character_reference",
      "usage": "auxiliary",
      "url": "https://example.com/xzn_side.png"
    }
  ]
}
```

### 8.3 Mention 提取

支持：

```text
[萧昭宁]
@萧昭宁
```

后端生成：

```json
{
  "mention_id": "m_001",
  "marker": "@萧昭宁",
  "entity_name": "萧昭宁",
  "reference_status": "bound",
  "matched_reference_ids": ["ref_char_xzn_001"]
}
```

---

## 9. RAGFlow / LLM Enhancement 规则

### 9.1 定位

RAGFlow / LLM 只做可选结构化增强，不是生产必经单点。

它可以输出：

```text
scene_summary
visual_focus
story_function
action_stages
shot_plan
normalized_shot_plan
lighting_notes
composition_notes
negative_notes
input_analysis
storyboard_processing
```

不得输出：

```text
final_prompt
compiled_prompt
reference_id 新增/修改
图片 URL
API response
```

### 9.2 Enhancement 丢弃条件

出现以下任一情况，后端必须丢弃 enhancement，并使用本地模板继续真实生图：

1. RAGFlow / LLM 调用失败。
2. 超时。
3. 输出不是 JSON。
4. 顶层不是对象。
5. 出现 `final_prompt` / `compiled_prompt` 字段。
6. 出现新的 `reference_id`。
7. 出现未在 `resolved_references` 中的图片 URL。
8. `storyboard_processing` 与实际字段不匹配。
9. `shot_plan` / `normalized_shot_plan` 存在但不是数组。
10. 路径二中 `normalized_shot_plan` 改变用户原 shot 数量或顺序。
11. `negative_notes` 含内部实现信息，例如 RAGFlow、fallback、本地模板兜底。
12. enhancement 超过配置的最大长度。

丢弃 enhancement 不得导致普通 API 失败。只要本地模板和真实 provider 能继续生成图片，外部仍返回 `succeeded`。

---

## 10. Storyboard 三路径规则

后端不写死 `storyboard_input_type`，也不让下游传该字段。

当 `task_type = storyboard` 时，后端只做：

1. prompt 非空。
2. references 校验。
3. entity_mentions 抽取。
4. reference binding。
5. 防串图。

然后将 `raw_prompt + entity_mentions + resolved_references + output` 交给 RAGFlow / LLM 获取结构化 enhancement。

### 10.1 路径一：剧情 / 剧本 / 对白 → 转分镜

适用于原始剧本、剧情段落、对白片段、场景描述、动作描述。

RAGFlow / LLM 应输出：

```text
scene_summary
story_function
action_stages
shot_plan
lighting_notes
composition_notes
negative_notes
```

Prompt Compiler 使用：

```text
raw_prompt + shot_plan + scene_summary + action_stages + references_description + 本地故事板模板 + 负向约束
```

### 10.2 路径二：已有分镜 / shot 清单 → 规范化

适用于用户已有镜头 1 / 镜头 2 / shot list。

RAGFlow / LLM 必须：

1. 保留用户原 shot 数量。
2. 保留用户原 shot 顺序。
3. 保留每个 shot 的核心动作。
4. 只补景别、运镜、光影、左侧规划区、负向约束。
5. 不重拆、不重排、不合并、不删除。

Prompt Compiler 使用：

```text
normalized_shot_plan + references_description + 本地故事板模板 + 负向约束
```

如果 `normalized_shot_plan` 数量或顺序与用户原 shot 清单不一致，必须丢弃 enhancement，走本地兜底模板。

### 10.3 路径三：完整故事板提示词 → 保留增强

适用于用户已经提供完整 storyboard prompt。

RAGFlow / LLM 必须：

1. 保留 raw_prompt 为主体。
2. 不重写用户原提示词。
3. 只输出缺失约束、参考绑定说明、布局硬约束、负向规则。

Prompt Compiler 使用：

```text
raw_prompt + references_description + missing_constraints + negative_notes
```

### 10.4 RAGFlow 失败兜底

若 RAGFlow / LLM 不可用，后端直接使用：

```text
raw_prompt + references_description + 通用故事板模板 + 负向约束
```

对外不返回故事板路径判断、RAGFlow 状态、fallback 状态。

---

## 11. Prompt Compiler 规则

最终内部 `final_prompt` 只能由后端 Prompt Compiler 确定性生成。

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

```text
compiled_prompt / final_prompt，仅内部使用
provider_payload，仅内部使用
references_used，仅内部使用或脱敏返回
```

普通 API 响应不得返回 `compiled_prompt` / `final_prompt`。

### 11.1 六类模板

Prompt Compiler 必须支持：

```text
text_image
image_reference
character_multiview
scene_multiview
prop_multiview
storyboard
```

### 11.2 专项硬约束

#### character_multiview

必须生成 4 格横向角色设定图：

```text
1. 正面全身站姿
2. 正面头部特写
3. 侧面全身站姿
4. 背面全身站姿
```

硬要求：完整头到脚、鞋子可见、A 字站姿、手上无道具、头部特写只能一个、纯色背景、禁止文字/标签/水印/多个头部特写/缺侧面/缺背面。

#### scene_multiview

最终交付物是场景空间 / 现场光影 / 调度 / 多机位参考板。人物只作为现场比例、动作、调度和光影锚点，不改变场景多视图属性。

#### prop_multiview

最终交付物是道具资产多视图 / 结构 / 材质 / 纹样参考板。角色 / 场景只作为比例和使用语境，不改变道具主交付物属性。

#### storyboard

最终交付物是剧情宫格电影分镜制作板，包含左侧规划区和右侧剧情宫格区。左侧包含场景走位示意图、氛围概念图、光影变化示意；右侧按剧情动作阶段或已有 shot 清单生成分镜，自适应排版。禁止固定九宫格 / 四宫格 / 2x2 / 3x3，禁止文字遮挡主体、角色漂移、场景漂移、动作顺序错误。

---

## 12. Response Schema

### 12.1 成功响应

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
      "url": "https://provider.example.com/generated.png",
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
      }
    ],
    "references_used": [
      {
        "reference_id": "ref_char_xzn_001",
        "entity_name": "萧昭宁",
        "role_label": "角色参考图",
        "usage": "auxiliary"
      }
    ]
  },
  "warnings": [],
  "trace_id": "trace_20260606_001"
}
```

### 12.2 成功响应禁止字段

不得返回：

```text
final_prompt
final_prompt_preview
compiled_prompt
enhancement
input_analysis
storyboard_processing
storyboard_path
provider_internal_payload
RAGFlow 是否失败
是否使用本地模板
fallback 状态
```

---

## 13. Status 与 error_code 映射

### 13.1 succeeded

真实 provider 返回至少一张可访问图片 URL，并成功标准化为 `images[]`。

### 13.2 needs_clarification

用于下游可以补充信息后重试的错误：

```text
REFERENCE_REQUIRED
ENTITY_REFERENCE_NOT_FOUND 且 reference_policy.unbound_entity = block
PROMPT_REQUIRED，如果前端可补
UNSUPPORTED_TASK_TYPE，如果前端可重新选择
```

### 13.3 failed

用于请求非法或系统无法完成：

```text
INVALID_REQUEST_SCHEMA
DUPLICATE_REFERENCE_ID
DUPLICATE_ENTITY_ROLE_REFERENCE
MULTIPLE_PRIMARY_REFERENCES
INVALID_REFERENCE_ROLE
REFERENCES_NOT_ALLOWED
PROVIDER_CONFIG_MISSING
IMAGE_PROVIDER_CALL_FAILED
IMAGE_PROVIDER_TIMEOUT
IMAGE_RESULT_EMPTY
PROVIDER_RESPONSE_UNSUPPORTED
CALLBACK_NOT_IMPLEMENTED
```

当前版本不实现 callback，因此不得出现成功执行 callback 的逻辑。

---

## 14. Codex BLOCKED 停止条件

Codex 虽然全自主执行，但遇到以下情况必须停止，输出 BLOCKED，不得伪造成功：

```text
BLOCKED_BY_MISSING_AI_TU_SOURCE：找不到 ai-tu gateway 源码。
BLOCKED_BY_PROVIDER_LOGIC_NOT_FOUND：找不到真实 provider 调用逻辑。
BLOCKED_BY_MISSING_PROVIDER_CONFIG：provider key / base URL / model 等配置缺失。
BLOCKED_BY_PROVIDER_URL_UNSUPPORTED：provider 不返回图片 URL，只返回 base64 / binary / 临时文件。
BLOCKED_BY_BROWSER_UNAVAILABLE：Codex Browser / Computer Use 无法访问测试台。
BLOCKED_BY_VISUAL_FLOW_FAILED：无法完成真实视觉点击流程。
BLOCKED_BY_RAGFLOW_CONFIG_MISSING：若 SPEC 要求启用 RAGFlow 但本地没有配置。
BLOCKED_BY_SECRET_REQUIRED：需要私人令牌但本地环境没有安全配置。
```

Codex 不得通过以下方式绕过 BLOCKED：

1. 使用 fake image URL。
2. 使用 mock provider 冒充真实 provider。
3. 用 curl / API 脚本替代视觉点击验收。
4. 跳过 provider，直接写死成功响应。
5. 直接把内部 final_prompt 当 evidence。

---

## 15. 可视化业务测试台

必须提供一个可见页面，用于真实业务流验收。

页面至少包含：

1. `task_type` 选择。
2. prompt 文本框。
3. `references[]` 可视化编辑区。
4. 每张参考图可填写：`reference_id`、`entity_name`、`entity_type`、`role`、`usage`、`url`、`mime_type`、`display_name`、`description`。
5. `reference_policy.unbound_entity` 选择。
6. `output.aspect_ratio`、`quality`、`count`。
7. 提交按钮。
8. 请求结果展示区。
9. 图片 URL / 图片预览区。
10. 业务 warnings 展示区。
11. trace_id 展示区。

测试台只用于业务验收，不是最终客户 UI。

---

## 16. 视觉验收硬约束

核心验收必须通过 Codex 内置浏览器 / Computer Use 进行真实可见页面操作。

必须完成：

```text
打开测试台
↓
真实点击选择 task_type
↓
真实输入 prompt
↓
真实填写 references[].url / entity_name / role / usage
↓
真实点击提交
↓
页面发起 POST /api/v1/image-generations
↓
真实 provider 返回图片 URL
↓
页面展示图片
↓
保存截图 / trace / network evidence
```

禁止：

1. 用 curl 代替核心验收。
2. 用后端日志代替核心验收。
3. 用纯 API 脚本代替核心验收。
4. 用 DOM 读取代替可见页面审查。
5. 用 Playwright 脚本直接 `page.fill()` / `page.click()` 冒充 Codex Browser / Computer Use 视觉点击验收。

Playwright 只能用于辅助保存 trace、截图、network，不得替代核心视觉点击判断。

---

## 17. Evidence 脱敏规则

必须生成：

```text
evidence/visual-e2e-report.md
evidence/network-summary.json
evidence/screenshots/*.png
```

普通 evidence 可以记录：

1. 测试时间。
2. 测试 task_type。
3. 原始 input.prompt 摘要。
4. reference_id / entity_name / role / usage。
5. API endpoint。
6. HTTP status。
7. response 是否包含 images[]。
8. response 是否不包含禁止字段。
9. trace_id。
10. 页面截图路径。
11. 生成图片 URL。

普通 evidence 不得包含：

```text
final_prompt
compiled_prompt
provider_internal_payload
RAGFlow 原始输出
provider key
RAGFlow key
Gitee token
Authorization header
Cookie
私人令牌
```

若需要内部排查，完整内部 trace 只能保存在本地安全 trace store，不得写入普通 evidence。

---

## 18. 推荐目录结构

若当前项目为 Python/FastAPI 主体，优先在现有项目中新建最终 API 模块，不污染旧 runtime：

```text
src/prompt_proj/image_api/
  __init__.py
  routes.py
  schemas.py
  entity_mentions.py
  reference_binding.py
  prompt_compiler.py
  ragflow_enhancement.py
  runtime.py
  errors.py
  labels.py
  providers/
    __init__.py
    base.py
    ai_tu_provider_adapter.py
  web/
    static/
      index.html
      app.js
      style.css
```

测试目录：

```text
tests/image_api/
  test_schemas.py
  test_entity_mentions.py
  test_reference_binding.py
  test_prompt_compiler.py
  test_storyboard_paths.py
  test_api_response_contract.py
  test_provider_adapter_contract.py
  test_real_provider_integration.py
```

视觉验收 evidence 目录：

```text
evidence/
  visual-e2e-report.md
  network-summary.json
  screenshots/
```

---

## 19. 测试要求

### 19.1 单元测试允许 fake adapter

单元测试可以使用 fake provider adapter 测试 schema、binding、compiler、error mapping。

但 fake provider 的测试结果不得作为业务成功验收。

### 19.2 集成测试必须使用真实 provider 或 BLOCKED

真实 provider 集成测试必须：

1. 读取本地 provider 环境变量。
2. 无配置时标记 `BLOCKED_BY_MISSING_PROVIDER_CONFIG` 或 pytest skip with reason。
3. 有配置时调用真实 provider。
4. 返回真实图片 URL。

### 19.3 视觉 E2E 必须真实 provider

视觉 E2E 必须通过真实页面 + 真实 provider 完成。无 provider 配置时不得假成功。

---

## 20. 测试矩阵

Codex 必须覆盖：

1. `text_image` 无 references 成功。
2. `text_image` 传 references 返回 `REFERENCES_NOT_ALLOWED`。
3. `image_reference` 有 references 成功。
4. `character_multiview` 角色主参考成功。
5. `character_multiview` 角色 + 场景辅助成功。
6. `character_multiview` 缺人物脸部参考图或角色参考图，返回 `REFERENCE_REQUIRED`。
7. `scene_multiview` 场景主参考成功。
8. `scene_multiview` 场景主参考 + 角色辅助成功。
9. `scene_multiview` 用例：`生成 @萧昭宁 在 @营帐 中的现场光影多视角参考图` 成功。
10. `prop_multiview` 道具主参考成功。
11. `storyboard` 纯剧情走剧情转分镜路径。
12. `storyboard` 对白片段走剧情转分镜路径。
13. `storyboard` 已有镜头清单走已有分镜规范化路径。
14. `storyboard` 保留原 shot 顺序和数量。
15. `storyboard` 完整故事板提示词走保留增强路径。
16. `storyboard` RAGFlow 失败，后端本地模板兜底继续真实生图。
17. `[]` 实体提取成功。
18. `@` 实体提取成功。
19. 同一实体多次出现，生成多个 `mention_id`，绑定同一 `reference_id`。
20. `reference_id` 重复返回 `DUPLICATE_REFERENCE_ID`。
21. 同一 `entity_name + role` 多张图无 `usage` 返回 `DUPLICATE_ENTITY_ROLE_REFERENCE`。
22. 同一 `entity_name + role` 多张图有 `primary/auxiliary` 成功。
23. `unbound_entity=warn` 返回业务 warning 但继续生成。
24. `unbound_entity=block` 返回 `needs_clarification`。
25. RAGFlow 输出 `final_prompt` 被丢弃。
26. RAGFlow 输出越权 `reference_id` 被丢弃。
27. Provider 不返回 URL 返回 `PROVIDER_RESPONSE_UNSUPPORTED`。
28. Provider 异步超时返回 `IMAGE_PROVIDER_TIMEOUT`。
29. API 成功响应不包含 `final_prompt`。
30. API 成功响应不包含 `enhancement`。
31. API 成功响应不包含 RAGFlow/fallback/storyboard path。
32. 视觉点击 E2E 生成真实图片并展示。
33. evidence 不包含密钥、final_prompt、provider internal payload。

---

## 21. Codex 执行流程

Codex 必须按以下顺序执行：

```text
Step 1：只读审查
  - 读取本 SPEC
  - 扫描当前最终 API 项目
  - 扫描 ai-tu gateway 源码
  - 输出 Provider Adapter 迁移映射表
  - 输出文件改动计划
  - 不写代码

Step 2：实现 schema / binding / compiler 本地链路
  - 不接真实 provider 前，先跑单元测试
  - 可用 fake adapter 进行单元测试，但不得作为业务验收

Step 3：迁移 ai-tu gateway provider 能力
  - 只迁移允许项
  - 不迁移上传 / multipart / 图床 / 旧 UI / 旧 response

Step 4：接真实 provider
  - 有配置则真实调用
  - 无配置则 BLOCKED，不假成功

Step 5：实现可视化业务测试台

Step 6：Codex Browser / Computer Use 视觉点击验收

Step 7：Review
  - 检查 API 响应禁止字段
  - 检查 provider 真实链路
  - 检查 evidence 脱敏

Step 8：Fix
  - 修复发现的问题

Step 9：Re-review
  - 再次执行视觉点击和测试矩阵
```

---

## 22. 最终验收标准

只有同时满足以下条件，才算通过：

1. `POST /api/v1/image-generations` 可用。
2. 可视化测试台可用。
3. 真实浏览器视觉点击流程完成。
4. 真实 provider 被调用。
5. 返回真实图片 URL。
6. 前端展示真实图片。
7. API 成功响应不包含任何内部 prompt / enhancement / fallback 字段。
8. evidence 不包含密钥或内部 prompt。
9. Provider Adapter 迁移映射表存在。
10. 所有 P0 测试通过，或明确 BLOCKED 且理由真实。

---

## 23. 最终一句话

Codex 要实现的是：**一个独立部署的最终版提示词优化生图 API 服务；下游通过 JSON 请求传 `prompt + references[].url`；后端确定性完成实体绑定、防串图、Prompt Compiler 编译内部 `final_prompt`；RAGFlow / LLM 只做可选结构化增强；Provider Adapter 从 ai-tu gateway 复制迁移真实上游调用能力；不迁移上传、不 mock、不泄露内部 prompt；最终用 Codex Browser / Computer Use 真实视觉点击走完整业务链路并返回真实图片。**
