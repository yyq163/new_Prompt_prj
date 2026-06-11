# RAGFlow Knowledge Seed Documents

These files are seed material for the RAGFlow knowledge base. They are not read
directly by application code. The backend sends task metadata to RAGFlow, accepts
a validated JSON enhancement object when available, and compiles a provider
prompt with only a minimal local fallback when no enhancement is returned.

Each seed document uses:

- `title`
- `applicable_task_type`
- `purpose`
- `input_signals`
- `output_fields`
- `template_rules`
- `negative_constraints`
- `disabled_when`
- `source_mode`
- `derived_from`
- `notes`

The template rules are project business templates derived from product
discussion. They are not claims about external model, platform, or provider
capability.

Do not add external `source_url` values unless they are real, verified, and
needed. Optional recommendations should stay optional.
