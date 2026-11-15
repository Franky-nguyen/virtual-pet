use crate::png_codec::{
    decode_png, extract_palette_from_rgba_samples, get_tile_bounding_box,
    normalize_to_horizontal_strip, synthesize_all_animations, FrameRect, PNG_SIGNATURE,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};

pub const AUTOSPRITE_PET_PROMPT: &str = "Create a consistent 2D pixel-art sprite pack from the supplied pet reference photos. Preserve the pet’s species, body shape, face, fur colors, markings, ears, tail, eye color, and distinctive accessories. Use a transparent background, crisp nearest-neighbor pixel edges, and a consistent camera angle, scale, ground position, and silhouette across every frame. Produce separate horizontal sprite sheets for idle, walk, hurt, death, attack, and evolution. Each frame must use the same tile size and alignment. Do not add text, borders, scenery, shadows, or unrelated objects. The pet must remain recognizable as the same individual in every animation.";

pub const ALLOWED_SPECIES: [&str; 7] = ["dog", "cat", "rabbit", "hamster", "bird", "fox", "other"];
pub const ALLOWED_MIME_TYPES: [&str; 3] = ["image/jpeg", "image/png", "image/webp"];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAnimationSpec {
    pub file: String,
    pub frames: usize,
    pub tile_width: usize,
    pub tile_height: usize,
    pub frame_duration_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePhotoMetadata {
    pub name: String,
    pub mime_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CustomPetAnimations {
    pub idle: CustomAnimationSpec,
    pub walk: CustomAnimationSpec,
    pub hurt: CustomAnimationSpec,
    pub death: CustomAnimationSpec,
    pub attack: CustomAnimationSpec,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evolution: Option<CustomAnimationSpec>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomPetManifest {
    pub id: String,
    pub name: String,
    pub species: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub breed: Option<String>,
    pub created_at: String,
    pub source_photos: Vec<SourcePhotoMetadata>,
    pub animations: CustomPetAnimations,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCustomPet {
    pub manifest: CustomPetManifest,
    pub sprite_urls: HashMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SpriteValidationReport {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedPetPhoto {
    pub name: String,
    pub mime_type: String,
    pub data_url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomPetRequest {
    pub name: String,
    pub species: String,
    pub breed: Option<String>,
    pub photos: Vec<UploadedPetPhoto>,
    pub pipeline: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportMeta {
    pub name: Option<String>,
    pub species: Option<String>,
    pub breed: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PetCreationProgress {
    pub stage: String,
    pub message: String,
    pub percent: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomPetResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pet: Option<RuntimeCustomPet>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<SpriteValidationReport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Vec<String>>,
}

impl CreateCustomPetResult {
    pub fn err(code: &str, error: impl Into<String>, details: Option<Vec<String>>) -> Self {
        Self {
            ok: false,
            pet: None,
            validation: None,
            source: None,
            error: Some(error.into()),
            code: Some(code.to_string()),
            details,
        }
    }

    pub fn success(
        pet: RuntimeCustomPet,
        validation: SpriteValidationReport,
        source: &str,
    ) -> Self {
        Self {
            ok: true,
            pet: Some(pet),
            validation: Some(validation),
            source: Some(source.to_string()),
            error: None,
            code: None,
            details: None,
        }
    }
}

pub fn normalized_spec(key: &str) -> CustomAnimationSpec {
    let (file, frames) = match key {
        "idle" => ("idle.png", 4),
        "walk" => ("walk.png", 6),
        "hurt" => ("hurt.png", 2),
        "death" => ("death.png", 3),
        "attack" => ("attack.png", 4),
        "evolution" => ("evolution.png", 8),
        _ => ("idle.png", 4),
    };
    CustomAnimationSpec {
        file: file.to_string(),
        frames,
        tile_width: 64,
        tile_height: 64,
        frame_duration_ms: 150,
    }
}

pub fn is_valid_pet_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    if bytes.len() < 3 || bytes.len() > 64 || id.contains("..") {
        return false;
    }
    let first = bytes[0];
    let last = bytes[bytes.len() - 1];
    if !(first.is_ascii_lowercase() || first.is_ascii_digit())
        || !(last.is_ascii_lowercase() || last.is_ascii_digit())
    {
        return false;
    }
    bytes.iter().all(|&b| {
        b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_'
    })
}

pub fn get_custom_pets_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve appDataDir: {e}"))?;
    let dir = base.join("custom-pets");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create custom-pets dir: {e}"))?;
    }
    Ok(dir)
}

pub fn resolve_safe_pet_dir(app: &AppHandle, pet_id: &str) -> Result<PathBuf, String> {
    if !is_valid_pet_id(pet_id) {
        return Err("Invalid pet ID format.".to_string());
    }
    let root = get_custom_pets_root_dir(app)?;
    let target = root.join(pet_id);
    if target.parent() != Some(root.as_path()) {
        return Err("Path traversal blocked.".to_string());
    }
    Ok(target)
}

fn generate_pet_id(name: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            prev_dash = false;
        } else if !prev_dash && !slug.is_empty() {
            slug.push('-');
            prev_dash = true;
        }
    }
    let slug = slug.trim_matches('-');
    let slug = if slug.is_empty() {
        "custom-pet"
    } else if slug.len() > 24 {
        slug[..24].trim_matches('-')
    } else {
        slug
    };
    let rand_bytes: u32 = rand::thread_rng().gen();
    format!("{}-{:08x}", slug, rand_bytes)
}

pub fn validate_single_sprite_sheet(
    anim_key: &str,
    png_buffer: &[u8],
    spec: &CustomAnimationSpec,
) -> SpriteValidationReport {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    if png_buffer.len() < 33 || png_buffer[0..8] != PNG_SIGNATURE {
        return SpriteValidationReport {
            valid: false,
            errors: vec![format!("[{anim_key}] File is not a valid PNG binary.")],
            warnings,
        };
    }

    let decoded = match decode_png(png_buffer) {
        Ok(d) => d,
        Err(e) => {
            return SpriteValidationReport {
                valid: false,
                errors: vec![format!("[{anim_key}] Failed to decode PNG: {e}")],
                warnings,
            }
        }
    };

    if decoded.width < 32
        || decoded.width > 4096
        || decoded.height < 32
        || decoded.height > 512
    {
        errors.push(format!(
            "[{anim_key}] Unreasonable dimensions ({}x{}).",
            decoded.width, decoded.height
        ));
    }

    if spec.tile_width == 0 || spec.tile_height == 0 || spec.tile_width != spec.tile_height {
        errors.push(format!(
            "[{anim_key}] Tile dimensions must be equal square pixels (got {}x{}).",
            spec.tile_width, spec.tile_height
        ));
    }

    if decoded.height != spec.tile_height {
        errors.push(format!(
            "[{anim_key}] Expected single horizontal strip of height {}px, got {}px.",
            spec.tile_height, decoded.height
        ));
    }

    let expected_width = spec.frames * spec.tile_width;
    if decoded.width != expected_width {
        errors.push(format!(
            "[{anim_key}] Width {}px does not match {} frames × {}px ({}px).",
            decoded.width, spec.frames, spec.tile_width, expected_width
        ));
    }

    if !errors.is_empty() {
        return SpriteValidationReport {
            valid: false,
            errors,
            warnings,
        };
    }

    let mut transparent_count = 0usize;
    let mut solid_opaque_count = 0usize;
    let mut semi_transparent_count = 0usize;
    let total_pixels = decoded.width * decoded.height;

    for i in 0..total_pixels {
        let a = decoded.rgba[i * 4 + 3];
        if a == 0 {
            transparent_count += 1;
        } else if a >= 240 {
            solid_opaque_count += 1;
        } else {
            semi_transparent_count += 1;
        }
    }

    if transparent_count == 0 {
        errors.push(format!(
            "[{anim_key}] Sprite sheet lacks RGBA transparency (0 transparent background pixels found)."
        ));
    }

    let visible_pixels = solid_opaque_count + semi_transparent_count;
    if visible_pixels == 0 {
        errors.push(format!(
            "[{anim_key}] Sprite sheet is completely empty/transparent."
        ));
    } else {
        let hard_edge_ratio = solid_opaque_count as f64 / visible_pixels as f64;
        if hard_edge_ratio < 0.75 {
            errors.push(format!(
                "[{anim_key}] Sprite sheet has soft/blurry edges (only {}% hard opaque pixels; expected >= 75% for pixel art).",
                (hard_edge_ratio * 100.0).round() as i32
            ));
        } else if hard_edge_ratio < 0.9 {
            warnings.push(format!(
                "[{anim_key}] Minor anti-aliased fringe detected ({}% crisp pixels).",
                (hard_edge_ratio * 100.0).round() as i32
            ));
        }
    }

    let mut boxes = Vec::with_capacity(spec.frames);
    for f in 0..spec.frames {
        let b = get_tile_bounding_box(
            &decoded.rgba,
            decoded.width,
            f * spec.tile_width,
            0,
            spec.tile_width,
            spec.tile_height,
        );
        if b.opaque_count < 16 {
            errors.push(format!(
                "[{anim_key}] Frame {}/{} is empty or nearly blank ({} opaque pixels).",
                f + 1,
                spec.frames,
                b.opaque_count
            ));
        }
        boxes.push(b);
    }

    if boxes.len() > 1 && boxes.iter().all(|b| b.opaque_count >= 16) {
        let min_cx = boxes
            .iter()
            .map(|b| b.center_x)
            .fold(f64::INFINITY, f64::min);
        let max_cx = boxes
            .iter()
            .map(|b| b.center_x)
            .fold(f64::NEG_INFINITY, f64::max);
        let min_by = boxes
            .iter()
            .map(|b| b.bottom_y)
            .fold(f64::INFINITY, f64::min);
        let max_by = boxes
            .iter()
            .map(|b| b.bottom_y)
            .fold(f64::NEG_INFINITY, f64::max);

        let max_drift_x = max_cx - min_cx;
        let max_drift_y = max_by - min_by;
        let allowed_drift_x = spec.tile_width as f64 * 0.35;
        let allowed_drift_y = if anim_key == "death" {
            spec.tile_height as f64 * 0.45
        } else {
            spec.tile_height as f64 * 0.3
        };

        if max_drift_x > allowed_drift_x {
            errors.push(format!(
                "[{anim_key}] Unstable horizontal character placement across frames (drift {:.1}px > {:.1}px).",
                max_drift_x, allowed_drift_x
            ));
        }
        if max_drift_y > allowed_drift_y {
            errors.push(format!(
                "[{anim_key}] Unstable vertical ground placement across frames (drift {:.1}px > {:.1}px).",
                max_drift_y, allowed_drift_y
            ));
        }
    }

    SpriteValidationReport {
        valid: errors.is_empty(),
        errors,
        warnings,
    }
}

pub fn validate_manifest(manifest: &CustomPetManifest) -> Vec<String> {
    let mut errors = Vec::new();
    if !is_valid_pet_id(&manifest.id) {
        errors.push(
            "Invalid manifest id (must be alphanumeric/hyphenated, 3-64 chars, no path traversal)."
                .to_string(),
        );
    }
    if manifest.name.trim().is_empty() || manifest.name.trim().len() > 60 {
        errors.push("Invalid pet name (must be 1-60 characters).".to_string());
    }
    if !ALLOWED_SPECIES.contains(&manifest.species.as_str()) {
        errors.push(format!(
            "Invalid pet species (expected one of: {}).",
            ALLOWED_SPECIES.join(", ")
        ));
    }
    if let Some(ref b) = manifest.breed {
        if b.len() > 60 {
            errors.push("Invalid optional breed string.".to_string());
        }
    }
    for photo in &manifest.source_photos {
        if photo.name.is_empty() || photo.name.len() > 200 {
            errors.push("Invalid sourcePhoto name.".to_string());
        }
        if !ALLOWED_MIME_TYPES.contains(&photo.mime_type.as_str()) {
            errors.push(format!("Unsupported sourcePhoto mimeType: {}", photo.mime_type));
        }
    }

    let check_spec = |key: &str, spec: &CustomAnimationSpec, errs: &mut Vec<String>| {
        let expected = normalized_spec(key);
        if spec.file != expected.file {
            errs.push(format!(
                "Animation \"{key}\" file must be canonical \"{}\" (got \"{}\").",
                expected.file, spec.file
            ));
        }
        if spec.frames != expected.frames {
            errs.push(format!(
                "Animation \"{key}\" frames must be {} (got {}).",
                expected.frames, spec.frames
            ));
        }
        if spec.tile_width != 64 || spec.tile_height != 64 {
            errs.push(format!(
                "Animation \"{key}\" tile size must be 64×64 (got {}×{}).",
                spec.tile_width, spec.tile_height
            ));
        }
        if !(50..=1000).contains(&spec.frame_duration_ms) {
            errs.push(format!(
                "Animation \"{key}\" frameDurationMs must be between 50 and 1000ms."
            ));
        }
    };

    check_spec("idle", &manifest.animations.idle, &mut errors);
    check_spec("walk", &manifest.animations.walk, &mut errors);
    check_spec("hurt", &manifest.animations.hurt, &mut errors);
    check_spec("death", &manifest.animations.death, &mut errors);
    check_spec("attack", &manifest.animations.attack, &mut errors);
    if let Some(ref evo) = manifest.animations.evolution {
        check_spec("evolution", evo, &mut errors);
    }

    errors
}

pub fn validate_complete_pet_pack(
    manifest: &CustomPetManifest,
    files: &HashMap<String, Vec<u8>>,
) -> SpriteValidationReport {
    let mut errors = validate_manifest(manifest);
    let mut warnings = Vec::new();
    if !errors.is_empty() {
        return SpriteValidationReport {
            valid: false,
            errors,
            warnings,
        };
    }

    let mut specs: Vec<(&str, &CustomAnimationSpec)> = vec![
        ("idle", &manifest.animations.idle),
        ("walk", &manifest.animations.walk),
        ("hurt", &manifest.animations.hurt),
        ("death", &manifest.animations.death),
        ("attack", &manifest.animations.attack),
    ];
    if let Some(ref evo) = manifest.animations.evolution {
        specs.push(("evolution", evo));
    }

    for (key, spec) in specs {
        let Some(buf) = files.get(key) else {
            errors.push(format!(
                "Missing PNG file \"{}\" for animation \"{}\".",
                spec.file, key
            ));
            continue;
        };
        let report = validate_single_sprite_sheet(key, buf, spec);
        errors.extend(report.errors);
        warnings.extend(report.warnings);
    }

    SpriteValidationReport {
        valid: errors.is_empty(),
        errors,
        warnings,
    }
}

pub fn load_installed_pet_internal(app: &AppHandle, pet_id: &str) -> Option<RuntimeCustomPet> {
    let pet_dir = resolve_safe_pet_dir(app, pet_id).ok()?;
    let manifest_path = pet_dir.join("manifest.json");
    if !manifest_path.exists() {
        return None;
    }

    let raw_str = fs::read_to_string(&manifest_path).ok()?;
    let manifest: CustomPetManifest = serde_json::from_str(&raw_str).ok()?;
    if !validate_manifest(&manifest).is_empty() || manifest.id != pet_id {
        return None;
    }

    let mut specs: Vec<(&str, &CustomAnimationSpec)> = vec![
        ("idle", &manifest.animations.idle),
        ("walk", &manifest.animations.walk),
        ("hurt", &manifest.animations.hurt),
        ("death", &manifest.animations.death),
        ("attack", &manifest.animations.attack),
    ];
    if let Some(ref evo) = manifest.animations.evolution {
        specs.push(("evolution", evo));
    }

    let mut sprite_urls = HashMap::new();
    for (key, spec) in specs {
        let file_path = pet_dir.join(&spec.file);
        if file_path.parent() != Some(pet_dir.as_path()) || !file_path.exists() {
            return None;
        }
        let buf = fs::read(&file_path).ok()?;
        let check = validate_single_sprite_sheet(key, &buf, spec);
        if !check.valid {
            return None;
        }
        let b64 = BASE64.encode(&buf);
        sprite_urls.insert(key.to_string(), format!("data:image/png;base64,{b64}"));
    }

    Some(RuntimeCustomPet {
        manifest,
        sprite_urls,
    })
}

pub fn install_validated_pet_pack(
    app: &AppHandle,
    manifest: &CustomPetManifest,
    files: &HashMap<String, Vec<u8>>,
) -> Result<(RuntimeCustomPet, SpriteValidationReport), String> {
    let validation = validate_complete_pet_pack(manifest, files);
    if !validation.valid {
        return Err(format!(
            "Sprite validation failed: {}",
            validation.errors.join(" ")
        ));
    }

    let target_dir = resolve_safe_pet_dir(app, &manifest.id)?;
    let temp_dir = target_dir.with_file_name(format!(
        "{}.tmp-{}",
        manifest.id,
        chrono::Utc::now().timestamp_millis()
    ));

    let res = (|| -> Result<(), String> {
        fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
        let manifest_json =
            serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
        fs::write(temp_dir.join("manifest.json"), manifest_json).map_err(|e| e.to_string())?;

        for key in ["idle", "walk", "hurt", "death", "attack", "evolution"] {
            if let Some(buf) = files.get(key) {
                let spec = normalized_spec(key);
                fs::write(temp_dir.join(&spec.file), buf).map_err(|e| e.to_string())?;
            }
        }

        if target_dir.exists() {
            fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
        }
        fs::rename(&temp_dir, &target_dir).map_err(|e| e.to_string())?;
        Ok(())
    })();

    if temp_dir.exists() {
        let _ = fs::remove_dir_all(&temp_dir);
    }
    res?;

    let installed = load_installed_pet_internal(app, &manifest.id)
        .ok_or_else(|| "Failed to load newly installed pet pack.".to_string())?;
    Ok((installed, validation))
}

fn inspect_and_sample_photos(
    photos: &[UploadedPetPhoto],
) -> Result<(Vec<SourcePhotoMetadata>, Vec<(usize, usize, Vec<u8>)>), String> {
    if photos.is_empty() {
        return Err("Please upload at least one reference photo of your pet.".to_string());
    }
    if photos.len() > 6 {
        return Err("Maximum of 6 reference photos allowed.".to_string());
    }

    let mut source_meta = Vec::new();
    let mut samples = Vec::new();

    for photo in photos {
        if !ALLOWED_MIME_TYPES.contains(&photo.mime_type.as_str()) {
            return Err(format!(
                "Unsupported file type \"{}\" for \"{}\". Use JPG, PNG, or WebP.",
                photo.mime_type, photo.name
            ));
        }
        let expected_prefix = format!("data:{};base64,", photo.mime_type);
        if !photo.data_url.starts_with(&expected_prefix) {
            return Err(format!(
                "Photo \"{}\" has an invalid data URL header.",
                photo.name
            ));
        }
        let base64_part = &photo.data_url[expected_prefix.len()..];
        let raw_bytes = BASE64
            .decode(base64_part.trim())
            .map_err(|_| format!("Photo \"{}\" is empty or corrupt.", photo.name))?;

        if raw_bytes.len() < 16 {
            return Err(format!("Photo \"{}\" is empty or corrupt.", photo.name));
        }
        if raw_bytes.len() > 10 * 1024 * 1024 {
            return Err(format!(
                "Photo \"{}\" exceeds the 10 MB size limit.",
                photo.name
            ));
        }

        if let Ok(img) = image::load_from_memory(&raw_bytes) {
            let resized = img.thumbnail(64, 64).to_rgba8();
            samples.push((
                resized.width() as usize,
                resized.height() as usize,
                resized.into_raw(),
            ));
        } else if photo.mime_type == "image/png" {
            if let Ok(decoded) = decode_png(&raw_bytes) {
                samples.push((decoded.width, decoded.height, decoded.rgba));
            } else {
                return Err(format!(
                    "Could not decode image \"{}\". Please upload a valid JPG, PNG, or WebP photo.",
                    photo.name
                ));
            }
        } else {
            return Err(format!(
                "Could not decode image \"{}\". Please upload a valid JPG, PNG, or WebP photo.",
                photo.name
            ));
        }

        let safe_name = Path::new(&photo.name)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("photo.png")
            .chars()
            .take(120)
            .collect::<String>();

        source_meta.push(SourcePhotoMetadata {
            name: safe_name,
            mime_type: photo.mime_type.clone(),
        });
    }

    Ok((source_meta, samples))
}

fn resolve_autosprite_config() -> Option<(String, String)> {
    let env_url = std::env::var("AUTOSPRITE_MCP_URL")
        .unwrap_or_else(|_| "https://www.autosprite.io/api/mcp".to_string());
    if let Ok(key) = std::env::var("AUTOSPRITE_API_KEY") {
        let trimmed = key.trim();
        if !trimmed.is_empty() && trimmed != "vspk_your_api_key_here" {
            let auth = if trimmed.starts_with("Bearer ") {
                trimmed.to_string()
            } else {
                format!("Bearer {trimmed}")
            };
            return Some((env_url, auth));
        }
    }

    if cfg!(debug_assertions) {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .ok()?;
        let mcp_path = PathBuf::from(home)
            .join(".gemini")
            .join("antigravity")
            .join("mcp_config.json");
        if mcp_path.exists() {
            let raw: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(mcp_path).ok()?).ok()?;
            let server = raw.get("mcpServers")?.get("autosprite")?;
            let url = server
                .get("serverUrl")
                .or_else(|| server.get("url"))
                .and_then(|v| v.as_str())
                .unwrap_or(&env_url)
                .to_string();
            let auth = server
                .get("headers")?
                .get("Authorization")?
                .as_str()?
                .trim()
                .to_string();
            if !auth.is_empty() {
                return Some((url, auth));
            }
        }
    }

    None
}

fn parse_sse_or_json_rpc(body: &str) -> Result<serde_json::Value, String> {
    let trimmed = body.trim();
    if trimmed.starts_with('{') {
        return serde_json::from_str(trimmed).map_err(|e| e.to_string());
    }
    let data_lines: Vec<&str> = trimmed
        .lines()
        .filter_map(|l| l.strip_prefix("data: ").map(|s| s.trim()))
        .collect();
    for line in data_lines.into_iter().rev() {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            return Ok(val);
        }
    }
    Err("Unexpected response format from AutoSprite MCP server".to_string())
}

fn parse_atlas_rects(atlas_json: &serde_json::Value) -> Option<Vec<FrameRect>> {
    let frames_obj = atlas_json.get("frames")?.as_object()?;
    let mut keys: Vec<&String> = frames_obj.keys().collect();
    keys.sort_by_key(|k| k.parse::<i32>().unwrap_or(0));
    let mut rects = Vec::new();
    for k in keys {
        let entry = frames_obj.get(k)?;
        let cell = entry.get("frame").unwrap_or(entry);
        let x = cell.get("x")?.as_u64()? as usize;
        let y = cell.get("y")?.as_u64()? as usize;
        let w = cell.get("w")?.as_u64()? as usize;
        let h = cell.get("h")?.as_u64()? as usize;
        rects.push(FrameRect { x, y, w, h });
    }
    if rects.is_empty() {
        None
    } else {
        Some(rects)
    }
}

async fn generate_sprites_via_autosprite_mcp(
    app: &AppHandle,
    name: &str,
    species: &str,
    breed: Option<&str>,
    photos: &[UploadedPetPhoto],
) -> Result<HashMap<String, Vec<u8>>, (String, String)> {
    let Some((server_url, auth_header)) = resolve_autosprite_config() else {
        return Err((
            "MCP_UNAVAILABLE".to_string(),
            "AutoSprite MCP is not configured. Set AUTOSPRITE_API_KEY in your environment or use the local pixel-art synthesizer / pack importer.".to_string(),
        ));
    };

    let _ = app.emit(
        "custom-pets:progress",
        PetCreationProgress {
            stage: "sending".to_string(),
            message: "Connecting to AutoSprite MCP and uploading reference photos…".to_string(),
            percent: 22,
        },
    );

    let client = reqwest::Client::new();
    let mut session_id: Option<String> = None;
    let mut rpc_id = 1u64;

    // Initialize MCP session
    let init_res = client
        .post(&server_url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .header("Authorization", &auth_header)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": { "name": "posture-pet-desktop", "version": "2.0.0" }
            }
        }))
        .send()
        .await
        .map_err(|e| ("MCP_UNAVAILABLE".to_string(), e.to_string()))?;

    if !init_res.status().is_success() {
        return Err((
            "MCP_UNAVAILABLE".to_string(),
            format!(
                "AutoSprite MCP initialization failed (HTTP {})",
                init_res.status()
            ),
        ));
    }
    if let Some(sid) = init_res
        .headers()
        .get("mcp-session-id")
        .and_then(|h| h.to_str().ok())
    {
        session_id = Some(sid.to_string());
    }
    let _ = init_res.text().await;

    let call_tool = |tool_name: String,
                     args: serde_json::Value,
                     client: reqwest::Client,
                     server_url: String,
                     auth_header: String,
                     session_id: Option<String>,
                     id: u64| async move {
        let mut req = client
            .post(&server_url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .header("Authorization", &auth_header);
        if let Some(sid) = session_id {
            req = req.header("mcp-session-id", sid);
        }
        let res = req
            .json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": "tools/call",
                "params": { "name": tool_name, "arguments": args }
            }))
            .send()
            .await
            .map_err(|e| ("MCP_UNAVAILABLE".to_string(), e.to_string()))?;

        if !res.status().is_success() {
            return Err((
                "MCP_UNAVAILABLE".to_string(),
                format!("AutoSprite MCP tool \"{tool_name}\" failed (HTTP {})", res.status()),
            ));
        }

        let raw_text = res
            .text()
            .await
            .map_err(|e| ("MCP_UNAVAILABLE".to_string(), e.to_string()))?;
        let payload = parse_sse_or_json_rpc(&raw_text)
            .map_err(|e| ("MCP_UNAVAILABLE".to_string(), e))?;

        if let Some(err_obj) = payload.get("error") {
            let msg = err_obj
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("MCP RPC error")
                .to_string();
            let code = if msg.to_lowercase().contains("subscription") {
                "MCP_SUBSCRIPTION_REQUIRED"
            } else {
                "MCP_UNAVAILABLE"
            };
            return Err((code.to_string(), msg));
        }

        let result = payload.get("result").cloned().unwrap_or(serde_json::json!({}));
        let is_error = result
            .get("isError")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let content_text = result
            .get("content")
            .and_then(|c| c.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<&str>>()
                    .join("\n")
            })
            .unwrap_or_default();

        if is_error {
            let code = if content_text.to_lowercase().contains("subscription") {
                "MCP_SUBSCRIPTION_REQUIRED"
            } else {
                "MCP_UNAVAILABLE"
            };
            return Err((code.to_string(), content_text));
        }

        let mut structured = result.get("structuredContent").cloned();
        if structured.is_none() && content_text.trim_start().starts_with('{') {
            if let Some(first_block) = content_text.split("\n\n").next() {
                structured = serde_json::from_str(first_block).ok();
            }
        }

        Ok(structured.unwrap_or(serde_json::json!({})))
    };

    let species_desc = match breed {
        Some(b) if !b.is_empty() => format!("{b} {species}"),
        _ => species.to_string(),
    };
    let full_desc: String = format!(
        "{AUTOSPRITE_PET_PROMPT} Pet details: {name}, a {species_desc}."
    )
    .chars()
    .take(1000)
    .collect();

    rpc_id += 1;
    let upload_structured = call_tool(
        "upload_character".to_string(),
        serde_json::json!({
            "name": name.chars().take(100).collect::<String>(),
            "imageUrl": photos[0].data_url,
            "isHumanoid": false,
            "characterDescription": full_desc,
        }),
        client.clone(),
        server_url.clone(),
        auth_header.clone(),
        session_id.clone(),
        rpc_id,
    )
    .await?;

    let character_id = upload_structured
        .get("id")
        .and_then(|v| v.as_str())
        .or_else(|| {
            upload_structured
                .get("character")
                .and_then(|c| c.get("id"))
                .and_then(|v| v.as_str())
        })
        .ok_or_else(|| {
            (
                "MCP_UNAVAILABLE".to_string(),
                "AutoSprite upload_character did not return a characterId.".to_string(),
            )
        })?
        .to_string();

    let _ = app.emit(
        "custom-pets:progress",
        PetCreationProgress {
            stage: "generating".to_string(),
            message: "Requesting idle, walk, hurt, death, attack, and evolution animations from AutoSprite…".to_string(),
            percent: 40,
        },
    );

    rpc_id += 1;
    let gen_structured = call_tool(
        "generate_spritesheet".to_string(),
        serde_json::json!({
            "characterId": character_id,
            "animations": [
                { "kind": "idle", "loop": true },
                { "kind": "walk", "loop": true },
                { "kind": "hurt" },
                { "kind": "death" },
                { "kind": "attack" },
                {
                    "kind": "custom",
                    "name": "evolution",
                    "raw_prompt": true,
                    "prompt": format!("{AUTOSPRITE_PET_PROMPT} Animation: evolution transformation with a brief pixel energy glow settling into an evolved idle pose.")
                }
            ],
            "spritesheet": { "frameSize": 64, "frameCount": 8 },
            "videoTier": "turbo",
            "turboMode": "reference",
            "removeBg": "default",
            "withSound": false
        }),
        client.clone(),
        server_url.clone(),
        auth_header.clone(),
        session_id.clone(),
        rpc_id,
    )
    .await?;

    let job_id = gen_structured
        .get("jobId")
        .and_then(|v| v.as_str())
        .or_else(|| {
            gen_structured
                .get("jobIds")
                .and_then(|arr| arr.as_array())
                .and_then(|arr| arr.first())
                .and_then(|v| v.as_str())
        })
        .map(|s| s.to_string());

    if let Some(jid) = job_id {
        for attempt in 1..=12 {
            let _ = app.emit(
                "custom-pets:progress",
                PetCreationProgress {
                    stage: "generating".to_string(),
                    message: format!(
                        "AutoSprite rendering sprite sheets (check {attempt}/12)…"
                    ),
                    percent: (42 + attempt * 3).min(72),
                },
            );
            tokio::time::sleep(Duration::from_secs(31)).await;
            rpc_id += 1;
            let status_structured = call_tool(
                "get_job_status".to_string(),
                serde_json::json!({ "jobId": jid }),
                client.clone(),
                server_url.clone(),
                auth_header.clone(),
                session_id.clone(),
                rpc_id,
            )
            .await?;
            let status = status_structured
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            if status == "succeeded" || status == "completed" {
                break;
            }
            if status == "failed" || status == "error" {
                let reason = status_structured
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("AutoSprite generation job failed.");
                return Err(("MCP_UNAVAILABLE".to_string(), reason.to_string()));
            }
        }
    }

    let _ = app.emit(
        "custom-pets:progress",
        PetCreationProgress {
            stage: "validating".to_string(),
            message: "Downloading and normalizing sprite sheets…".to_string(),
            percent: 76,
        },
    );

    rpc_id += 1;
    let list_structured = call_tool(
        "list_spritesheets".to_string(),
        serde_json::json!({ "characterId": character_id, "latestOnly": true }),
        client.clone(),
        server_url.clone(),
        auth_header.clone(),
        session_id.clone(),
        rpc_id,
    )
    .await?;

    let items = list_structured
        .get("items")
        .or_else(|| list_structured.get("spritesheets"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut downloaded: HashMap<String, Vec<u8>> = HashMap::new();

    for item in items {
        let raw_kind = item
            .get("kind")
            .or_else(|| item.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        let anim_key = if raw_kind.contains("idle") {
            Some("idle")
        } else if raw_kind.contains("walk") {
            Some("walk")
        } else if raw_kind.contains("hurt") || raw_kind.contains("hit") {
            Some("hurt")
        } else if raw_kind.contains("death") {
            Some("death")
        } else if raw_kind.contains("attack") {
            Some("attack")
        } else if raw_kind.contains("evol") {
            Some("evolution")
        } else {
            None
        };

        let Some(key) = anim_key else { continue };
        if downloaded.contains_key(key) {
            continue;
        }

        let mut sheet_url = item
            .get("sheetUrl")
            .or_else(|| item.get("downloadUrl"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let mut atlas_url = item
            .get("atlasUrl")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        if sheet_url.is_none() {
            if let Some(sheet_id) = item
                .get("spritesheetId")
                .or_else(|| item.get("id"))
                .and_then(|v| v.as_str())
            {
                rpc_id += 1;
                if let Ok(detail) = call_tool(
                    "get_spritesheet".to_string(),
                    serde_json::json!({ "spritesheetId": sheet_id }),
                    client.clone(),
                    server_url.clone(),
                    auth_header.clone(),
                    session_id.clone(),
                    rpc_id,
                )
                .await
                {
                    sheet_url = detail
                        .get("sheetUrl")
                        .or_else(|| detail.get("downloadUrl"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    atlas_url = detail
                        .get("atlasUrl")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
            }
        }

        let Some(url) = sheet_url else { continue };
        let Ok(img_res) = client.get(&url).send().await else {
            continue;
        };
        if !img_res.status().is_success() {
            continue;
        }
        let Ok(png_bytes) = img_res.bytes().await else {
            continue;
        };

        let mut atlas_rects = None;
        if let Some(a_url) = atlas_url {
            if let Ok(a_res) = client.get(&a_url).send().await {
                if a_res.status().is_success() {
                    if let Ok(a_json) = a_res.json::<serde_json::Value>().await {
                        atlas_rects = parse_atlas_rects(&a_json);
                    }
                }
            }
        }

        if let Ok(decoded) = decode_png(&png_bytes) {
            let spec = normalized_spec(key);
            if let Ok(norm) = normalize_to_horizontal_strip(
                &decoded,
                spec.frames,
                spec.tile_width,
                atlas_rects.as_deref(),
            ) {
                downloaded.insert(key.to_string(), norm);
            }
        }
    }

    let Some(idle_buf) = downloaded.get("idle").cloned() else {
        return Err((
            "MCP_UNAVAILABLE".to_string(),
            "AutoSprite did not return a usable idle sprite sheet.".to_string(),
        ));
    };

    let idle_decoded = decode_png(&idle_buf).map_err(|e| ("MCP_UNAVAILABLE".to_string(), e))?;
    for key in ["idle", "walk", "hurt", "death", "attack", "evolution"] {
        if !downloaded.contains_key(key) {
            let spec = normalized_spec(key);
            let norm =
                normalize_to_horizontal_strip(&idle_decoded, spec.frames, spec.tile_width, None)
                    .map_err(|e| ("MCP_UNAVAILABLE".to_string(), e))?;
            downloaded.insert(key.to_string(), norm);
        }
    }

    Ok(downloaded)
}

pub fn import_pet_pack_from_dir_internal(
    app: &AppHandle,
    source_dir: &Path,
    meta: Option<ImportMeta>,
) -> CreateCustomPetResult {
    if !source_dir.exists() || !source_dir.is_dir() {
        return CreateCustomPetResult::err(
            "IO_ERROR",
            "Selected directory does not exist.",
            None,
        );
    }

    let mut name = meta
        .as_ref()
        .and_then(|m| m.name.as_ref())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            source_dir
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("Custom Pet")
                .to_string()
        });
    let mut species = meta
        .as_ref()
        .and_then(|m| m.species.as_ref())
        .map(|s| s.trim().to_string())
        .filter(|s| ALLOWED_SPECIES.contains(&s.as_str()))
        .unwrap_or_else(|| "dog".to_string());
    let mut breed = meta
        .as_ref()
        .and_then(|m| m.breed.as_ref())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let mut source_photos = vec![SourcePhotoMetadata {
        name: "imported_pack.png".to_string(),
        mime_type: "image/png".to_string(),
    }];

    let manifest_file = source_dir.join("manifest.json");
    if manifest_file.exists() {
        if let Ok(raw_str) = fs::read_to_string(&manifest_file) {
            if let Ok(raw) = serde_json::from_str::<serde_json::Value>(&raw_str) {
                if let Some(n) = raw.get("name").and_then(|v| v.as_str()) {
                    if !n.trim().is_empty() {
                        name = n.trim().chars().take(40).collect();
                    }
                }
                if let Some(sp) = raw.get("species").and_then(|v| v.as_str()) {
                    if ALLOWED_SPECIES.contains(&sp) {
                        species = sp.to_string();
                    }
                }
                if let Some(br) = raw.get("breed").and_then(|v| v.as_str()) {
                    if !br.trim().is_empty() {
                        breed = Some(br.trim().chars().take(40).collect());
                    }
                }
                if let Some(sp_arr) = raw.get("sourcePhotos") {
                    if let Ok(parsed_photos) =
                        serde_json::from_value::<Vec<SourcePhotoMetadata>>(sp_arr.clone())
                    {
                        if !parsed_photos.is_empty() {
                            source_photos = parsed_photos;
                        }
                    }
                }
            }
        }
    }

    let dir_entries: Vec<PathBuf> = match fs::read_dir(source_dir) {
        Ok(rd) => rd.filter_map(|e| e.ok().map(|d| d.path())).collect(),
        Err(e) => {
            return CreateCustomPetResult::err("IO_ERROR", e.to_string(), None);
        }
    };

    let find_sheet_file = |key: &str| -> Option<PathBuf> {
        let exact_name = format!("{key}.png");
        if let Some(p) = dir_entries.iter().find(|p| {
            p.file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.eq_ignore_ascii_case(&exact_name))
                .unwrap_or(false)
        }) {
            return Some(p.clone());
        }
        dir_entries
            .iter()
            .find(|p| {
                p.file_name()
                    .and_then(|s| s.to_str())
                    .map(|s| {
                        let lower = s.to_lowercase();
                        lower.ends_with(".png") && lower.contains(key)
                    })
                    .unwrap_or(false)
            })
            .cloned()
    };

    let Some(idle_path) = find_sheet_file("idle") else {
        return CreateCustomPetResult::err(
            "VALIDATION_FAILED",
            "Directory does not contain an idle.png sprite sheet.",
            None,
        );
    };

    let mut normalized_files: HashMap<String, Vec<u8>> = HashMap::new();
    for key in ["idle", "walk", "hurt", "death", "attack", "evolution"] {
        let file_path = find_sheet_file(key).unwrap_or_else(|| idle_path.clone());
        let raw_buf = match fs::read(&file_path) {
            Ok(b) => b,
            Err(e) => return CreateCustomPetResult::err("IO_ERROR", e.to_string(), None),
        };
        let decoded = match decode_png(&raw_buf) {
            Ok(d) => d,
            Err(e) => return CreateCustomPetResult::err("VALIDATION_FAILED", e, None),
        };
        let spec = normalized_spec(key);
        let pre_check = validate_single_sprite_sheet(key, &raw_buf, &spec);
        if pre_check.valid && file_path != idle_path {
            normalized_files.insert(key.to_string(), raw_buf);
        } else {
            match normalize_to_horizontal_strip(&decoded, spec.frames, spec.tile_width, None) {
                Ok(norm) => {
                    normalized_files.insert(key.to_string(), norm);
                }
                Err(e) => return CreateCustomPetResult::err("VALIDATION_FAILED", e, None),
            }
        }
    }

    let manifest = CustomPetManifest {
        id: generate_pet_id(&name),
        name,
        species,
        breed,
        created_at: chrono::Utc::now().to_rfc3339(),
        source_photos,
        animations: CustomPetAnimations {
            idle: normalized_spec("idle"),
            walk: normalized_spec("walk"),
            hurt: normalized_spec("hurt"),
            death: normalized_spec("death"),
            attack: normalized_spec("attack"),
            evolution: Some(normalized_spec("evolution")),
        },
    };

    let validation = validate_complete_pet_pack(&manifest, &normalized_files);
    if !validation.valid {
        let first_err = validation
            .errors
            .first()
            .cloned()
            .unwrap_or_else(|| "Unknown validation error".to_string());
        return CreateCustomPetResult::err(
            "VALIDATION_FAILED",
            format!("Imported sprite sheets failed validation: {first_err}"),
            Some(validation.errors),
        );
    }

    match install_validated_pet_pack(app, &manifest, &normalized_files) {
        Ok((pet, val)) => CreateCustomPetResult::success(pet, val, "import"),
        Err(e) => CreateCustomPetResult::err("IO_ERROR", e, None),
    }
}

pub async fn create_custom_pet_internal(
    app: &AppHandle,
    req: CreateCustomPetRequest,
) -> CreateCustomPetResult {
    let trimmed_name = req.name.trim().to_string();
    if trimmed_name.is_empty() || trimmed_name.len() > 40 {
        return CreateCustomPetResult::err(
            "INVALID_INPUT",
            "Please enter a pet name between 1 and 40 characters.",
            None,
        );
    }

    let species = if ALLOWED_SPECIES.contains(&req.species.as_str()) {
        req.species.clone()
    } else {
        "dog".to_string()
    };
    let breed = req
        .breed
        .as_ref()
        .map(|b| b.trim().chars().take(40).collect::<String>())
        .filter(|b| !b.is_empty());
    let pipeline = req
        .pipeline
        .as_deref()
        .unwrap_or("autosprite")
        .to_string();

    let _ = app.emit(
        "custom-pets:progress",
        PetCreationProgress {
            stage: "preparing".to_string(),
            message: "Validating and preparing reference photos…".to_string(),
            percent: 12,
        },
    );

    let (source_meta, samples) = if pipeline == "fixture" && req.photos.is_empty() {
        (
            vec![SourcePhotoMetadata {
                name: "fixture_reference.png".to_string(),
                mime_type: "image/png".to_string(),
            }],
            Vec::new(),
        )
    } else {
        match inspect_and_sample_photos(&req.photos) {
            Ok(res) => res,
            Err(e) => return CreateCustomPetResult::err("INVALID_INPUT", e, None),
        }
    };

    let (generated_files, used_source) = if pipeline == "autosprite" {
        match generate_sprites_via_autosprite_mcp(
            app,
            &trimmed_name,
            &species,
            breed.as_deref(),
            &req.photos,
        )
        .await
        {
            Ok(files) => (files, "autosprite"),
            Err((code, msg)) => return CreateCustomPetResult::err(&code, msg, None),
        }
    } else {
        let _ = app.emit(
            "custom-pets:progress",
            PetCreationProgress {
                stage: "sending".to_string(),
                message: "Analyzing reference photo color palette and markings…".to_string(),
                percent: 32,
            },
        );
        tokio::time::sleep(Duration::from_millis(220)).await;

        let _ = app.emit(
            "custom-pets:progress",
            PetCreationProgress {
                stage: "generating".to_string(),
                message: "Synthesizing 64×64 pixel-art sprite sheets (idle, walk, hurt, death, attack, evolution)…".to_string(),
                percent: 58,
            },
        );
        tokio::time::sleep(Duration::from_millis(260)).await;

        let palette = extract_palette_from_rgba_samples(&samples, &species);
        let files = match synthesize_all_animations(&species, &palette) {
            Ok(f) => f,
            Err(e) => return CreateCustomPetResult::err("VALIDATION_FAILED", e, None),
        };
        let src = if pipeline == "fixture" {
            "fixture"
        } else {
            "local-synth"
        };
        (files, src)
    };

    let _ = app.emit(
        "custom-pets:progress",
        PetCreationProgress {
            stage: "validating".to_string(),
            message: "Validating PNG format, RGBA transparency, tile geometry, and frame stability…".to_string(),
            percent: 82,
        },
    );

    let manifest = CustomPetManifest {
        id: generate_pet_id(&trimmed_name),
        name: trimmed_name,
        species,
        breed,
        created_at: chrono::Utc::now().to_rfc3339(),
        source_photos: source_meta,
        animations: CustomPetAnimations {
            idle: normalized_spec("idle"),
            walk: normalized_spec("walk"),
            hurt: normalized_spec("hurt"),
            death: normalized_spec("death"),
            attack: normalized_spec("attack"),
            evolution: Some(normalized_spec("evolution")),
        },
    };

    let validation = validate_complete_pet_pack(&manifest, &generated_files);
    if !validation.valid {
        let first_err = validation
            .errors
            .first()
            .cloned()
            .unwrap_or_else(|| "Validation failed".to_string());
        return CreateCustomPetResult::err(
            "VALIDATION_FAILED",
            format!("Generated assets failed validation: {first_err}"),
            Some(validation.errors),
        );
    }

    let _ = app.emit(
        "custom-pets:progress",
        PetCreationProgress {
            stage: "installing".to_string(),
            message: "Installing validated sprite pack to application data…".to_string(),
            percent: 95,
        },
    );

    let (pet, val) = match install_validated_pet_pack(app, &manifest, &generated_files) {
        Ok(res) => res,
        Err(e) => return CreateCustomPetResult::err("IO_ERROR", e, None),
    };

    let _ = app.emit(
        "custom-pets:progress",
        PetCreationProgress {
            stage: "installing".to_string(),
            message: "Pet installed!".to_string(),
            percent: 100,
        },
    );

    CreateCustomPetResult::success(pet, val, used_source)
}

#[tauri::command]
pub async fn custom_pets_list(app: AppHandle) -> Result<Vec<RuntimeCustomPet>, String> {
    let root = get_custom_pets_root_dir(&app)?;
    let Ok(entries) = fs::read_dir(&root) else {
        return Ok(Vec::new());
    };

    let mut pets: Vec<RuntimeCustomPet> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if !is_valid_pet_id(name) {
            continue;
        }
        if let Some(loaded) = load_installed_pet_internal(&app, name) {
            pets.push(loaded);
        }
    }

    pets.sort_by(|a, b| b.manifest.created_at.cmp(&a.manifest.created_at));
    Ok(pets)
}

#[tauri::command]
pub async fn custom_pets_get(
    app: AppHandle,
    pet_id: String,
) -> Result<Option<RuntimeCustomPet>, String> {
    Ok(load_installed_pet_internal(&app, &pet_id))
}

#[tauri::command]
pub async fn custom_pets_create(
    app: AppHandle,
    request: CreateCustomPetRequest,
) -> Result<CreateCustomPetResult, String> {
    Ok(create_custom_pet_internal(&app, request).await)
}

#[tauri::command]
pub async fn custom_pets_import_directory(
    app: AppHandle,
    meta: Option<ImportMeta>,
) -> Result<CreateCustomPetResult, String> {
    use tauri_plugin_dialog::DialogExt;

    let folder = app
        .dialog()
        .file()
        .set_title("Select Custom Pet Sprite Pack Folder")
        .blocking_pick_folder();

    let Some(file_path) = folder else {
        return Ok(CreateCustomPetResult::err(
            "INVALID_INPUT",
            "Folder selection was cancelled.",
            None,
        ));
    };

    let path_buf = file_path
        .into_path()
        .map_err(|e| format!("Invalid folder path: {e}"))?;

    Ok(import_pet_pack_from_dir_internal(&app, &path_buf, meta))
}

#[tauri::command]
pub async fn custom_pets_import_fixture(
    app: AppHandle,
    meta: Option<ImportMeta>,
) -> Result<CreateCustomPetResult, String> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let project_root = if cwd.ends_with("src-tauri") {
        cwd.parent().unwrap_or(&cwd).to_path_buf()
    } else {
        cwd
    };

    let resource_fixture = app
        .path()
        .resolve("fixtures/mochi-cat-pack", BaseDirectory::Resource)
        .ok()
        .filter(|p| p.exists());
    let dev_fixture = {
        let p = project_root.join("fixtures").join("mochi-cat-pack");
        if p.exists() {
            Some(p)
        } else {
            None
        }
    };

    let resolved_meta = ImportMeta {
        name: Some(
            meta.as_ref()
                .and_then(|m| m.name.as_ref())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "Mochi".to_string()),
        ),
        species: Some(
            meta.as_ref()
                .and_then(|m| m.species.as_ref())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "cat".to_string()),
        ),
        breed: Some(
            meta.as_ref()
                .and_then(|m| m.breed.as_ref())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "Calico".to_string()),
        ),
    };

    if let Some(fixture_dir) = resource_fixture.or(dev_fixture) {
        return Ok(import_pet_pack_from_dir_internal(
            &app,
            &fixture_dir,
            Some(resolved_meta),
        ));
    }

    Ok(create_custom_pet_internal(
        &app,
        CreateCustomPetRequest {
            name: resolved_meta.name.unwrap_or_else(|| "Mochi".to_string()),
            species: resolved_meta.species.unwrap_or_else(|| "cat".to_string()),
            breed: resolved_meta.breed,
            photos: Vec::new(),
            pipeline: Some("fixture".to_string()),
        },
    )
    .await)
}

#[derive(Serialize)]
pub struct DeletePetResult {
    pub ok: bool,
}

#[tauri::command]
pub async fn custom_pets_delete(
    app: AppHandle,
    pet_id: String,
) -> Result<DeletePetResult, String> {
    let Ok(pet_dir) = resolve_safe_pet_dir(&app, &pet_id) else {
        return Ok(DeletePetResult { ok: false });
    };
    if !pet_dir.exists() {
        return Ok(DeletePetResult { ok: false });
    }
    match fs::remove_dir_all(&pet_dir) {
        Ok(_) => Ok(DeletePetResult { ok: true }),
        Err(_) => Ok(DeletePetResult { ok: false }),
    }
}
