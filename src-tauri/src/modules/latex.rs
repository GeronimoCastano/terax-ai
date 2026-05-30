use std::sync::OnceLock;
use katex::{render_to_string, KatexContext, OutputFormat, Settings};

fn global_context() -> &'static KatexContext {
    static CTX: OnceLock<KatexContext> = OnceLock::new();
    CTX.get_or_init(KatexContext::default)
}

/// Render a LaTeX math expression to an HTML string.
///
/// The output uses only `<span>` elements with KaTeX class names
/// (`katex`, `katex-html`, etc.) and is compatible with the standard
/// `katex.min.css` stylesheet. MathML output is disabled so the result
/// can be embedded in markdown renderers that allow `span` tags.
#[tauri::command]
pub fn render_latex(latex: String, display_mode: Option<bool>) -> Result<String, String> {
    let settings = Settings::builder()
        .display_mode(display_mode.unwrap_or(false))
        .output(OutputFormat::Html)
        .throw_on_error(false)
        .build();

    render_to_string(global_context(), &latex, &settings).map_err(|e| e.to_string())
}
