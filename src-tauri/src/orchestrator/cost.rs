//! Per-stage cost and the all-premium baseline used to show savings.

use crate::provider_router::ProviderRouter;

/// Actual cost of a stage given its model and token counts.
pub fn stage_cost(model: &str, input_tokens: u64, output_tokens: u64) -> f64 {
    crate::token_engine::compute_cost(model, input_tokens, output_tokens, 0, 0)
}

/// Baseline cost: the same token counts priced at the reference (premium) model.
pub fn baseline_cost(reference_model: &str, input_tokens: u64, output_tokens: u64) -> f64 {
    crate::token_engine::compute_cost(reference_model, input_tokens, output_tokens, 0, 0)
}

/// Pick the premium reference model: highest blended (input+output) price among
/// enabled providers. Returns `None` if no models are configured.
pub fn pick_reference_model() -> Option<String> {
    let router = ProviderRouter::load().ok()?;
    router
        .list_models()
        .into_iter()
        .max_by(|a, b| {
            let pa = a.model.input_cost_per_m + a.model.output_cost_per_m;
            let pb = b.model.input_cost_per_m + b.model.output_cost_per_m;
            pa.partial_cmp(&pb).unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|m| m.model.id)
}
