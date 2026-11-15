use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::collections::HashMap;
use std::io::{Read, Write};

pub const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

#[derive(Clone, Debug)]
pub struct DecodedPng {
    pub width: usize,
    pub height: usize,
    pub bit_depth: u8,
    pub color_type: u8,
    pub rgba: Vec<u8>,
}

#[derive(Clone, Copy, Debug)]
pub struct FrameRect {
    pub x: usize,
    pub y: usize,
    pub w: usize,
    pub h: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct BoundingBox {
    pub min_x: i32,
    pub min_y: i32,
    pub max_x: i32,
    pub max_y: i32,
    pub opaque_count: usize,
    pub center_x: f64,
    pub bottom_y: f64,
}

fn paeth_predictor(a: i32, b: i32, c: i32) -> u8 {
    let p = a + b - c;
    let pa = (p - a).abs();
    let pb = (p - b).abs();
    let pc = (p - c).abs();
    if pa <= pb && pa <= pc {
        a as u8
    } else if pb <= pc {
        b as u8
    } else {
        c as u8
    }
}

pub fn decode_png(buf: &[u8]) -> Result<DecodedPng, String> {
    if buf.len() < 33 || buf[0..8] != PNG_SIGNATURE {
        return Err("Invalid PNG signature".to_string());
    }

    let mut offset = 8usize;
    let mut width = 0usize;
    let mut height = 0usize;
    let mut bit_depth = 0u8;
    let mut color_type = 0u8;
    let mut palette: Option<Vec<u8>> = None;
    let mut trns: Option<Vec<u8>> = None;
    let mut idat_chunks: Vec<u8> = Vec::new();
    let mut seen_ihdr = false;
    let mut seen_iend = false;

    while offset + 8 <= buf.len() {
        let length = u32::from_be_bytes([
            buf[offset],
            buf[offset + 1],
            buf[offset + 2],
            buf[offset + 3],
        ]) as usize;
        let chunk_type = std::str::from_utf8(&buf[offset + 4..offset + 8]).unwrap_or("");
        let data_start = offset + 8;
        let data_end = data_start.saturating_add(length);
        if data_end + 4 > buf.len() {
            return Err(format!("Truncated PNG chunk: {}", chunk_type));
        }
        let chunk_data = &buf[data_start..data_end];

        match chunk_type {
            "IHDR" => {
                if length < 13 {
                    return Err("Invalid IHDR chunk length".to_string());
                }
                width = u32::from_be_bytes([
                    chunk_data[0],
                    chunk_data[1],
                    chunk_data[2],
                    chunk_data[3],
                ]) as usize;
                height = u32::from_be_bytes([
                    chunk_data[4],
                    chunk_data[5],
                    chunk_data[6],
                    chunk_data[7],
                ]) as usize;
                bit_depth = chunk_data[8];
                color_type = chunk_data[9];
                let compression = chunk_data[10];
                let filter = chunk_data[11];
                let interlace = chunk_data[12];
                if compression != 0 || filter != 0 {
                    return Err("Unsupported PNG compression or filter method".to_string());
                }
                if interlace != 0 {
                    return Err(
                        "Interlaced PNGs are not supported; normalize to non-interlaced PNG"
                            .to_string(),
                    );
                }
                seen_ihdr = true;
            }
            "PLTE" => {
                palette = Some(chunk_data.to_vec());
            }
            "tRNS" => {
                trns = Some(chunk_data.to_vec());
            }
            "IDAT" => {
                idat_chunks.extend_from_slice(chunk_data);
            }
            "IEND" => {
                seen_iend = true;
                break;
            }
            _ => {}
        }

        offset = data_end + 4;
    }

    if !seen_ihdr || !seen_iend || width == 0 || height == 0 || idat_chunks.is_empty() {
        return Err("Incomplete PNG structure (missing IHDR, IDAT, or IEND)".to_string());
    }

    if bit_depth != 8 {
        return Err(format!(
            "Unsupported PNG bit depth: {} (expected 8-bit)",
            bit_depth
        ));
    }

    let channels = match color_type {
        6 => 4,
        2 => 3,
        4 => 2,
        0 | 3 => 1,
        _ => return Err(format!("Unsupported PNG color type: {}", color_type)),
    };

    let mut decoder = ZlibDecoder::new(&idat_chunks[..]);
    let mut inflated = Vec::new();
    decoder
        .read_to_end(&mut inflated)
        .map_err(|e| format!("Zlib decompression failed: {}", e))?;

    let stride = width * channels;
    let expected_length = height * (1 + stride);
    if inflated.len() < expected_length {
        return Err(format!(
            "Decompressed PNG data too short ({} < {})",
            inflated.len(),
            expected_length
        ));
    }

    let mut raw_scanlines = vec![0u8; width * height * channels];

    for y in 0..height {
        let filter_type = inflated[y * (1 + stride)];
        let row_in_offset = y * (1 + stride) + 1;
        let row_out_offset = y * stride;
        let prev_row_out_offset = y.saturating_sub(1) * stride;

        for x in 0..stride {
            let raw_byte = inflated[row_in_offset + x] as i32;
            let a = if x >= channels {
                raw_scanlines[row_out_offset + x - channels] as i32
            } else {
                0
            };
            let b = if y > 0 {
                raw_scanlines[prev_row_out_offset + x] as i32
            } else {
                0
            };
            let c = if x >= channels && y > 0 {
                raw_scanlines[prev_row_out_offset + x - channels] as i32
            } else {
                0
            };

            let recon = match filter_type {
                0 => raw_byte as u8,
                1 => ((raw_byte + a) & 0xff) as u8,
                2 => ((raw_byte + b) & 0xff) as u8,
                3 => ((raw_byte + ((a + b) >> 1)) & 0xff) as u8,
                4 => ((raw_byte + paeth_predictor(a, b, c) as i32) & 0xff) as u8,
                _ => return Err(format!("Invalid PNG scanline filter type: {}", filter_type)),
            };
            raw_scanlines[row_out_offset + x] = recon;
        }
    }

    let mut rgba = vec![0u8; width * height * 4];

    match color_type {
        6 => {
            rgba.copy_from_slice(&raw_scanlines);
        }
        2 => {
            let (trns_r, trns_g, trns_b) = if let Some(ref t) = trns {
                if t.len() >= 6 {
                    (
                        (u16::from_be_bytes([t[0], t[1]]) & 0xff) as i32,
                        (u16::from_be_bytes([t[2], t[3]]) & 0xff) as i32,
                        (u16::from_be_bytes([t[4], t[5]]) & 0xff) as i32,
                    )
                } else {
                    (-1, -1, -1)
                }
            } else {
                (-1, -1, -1)
            };
            for i in 0..(width * height) {
                let r = raw_scanlines[i * 3];
                let g = raw_scanlines[i * 3 + 1];
                let b = raw_scanlines[i * 3 + 2];
                rgba[i * 4] = r;
                rgba[i * 4 + 1] = g;
                rgba[i * 4 + 2] = b;
                rgba[i * 4 + 3] =
                    if r as i32 == trns_r && g as i32 == trns_g && b as i32 == trns_b {
                        0
                    } else {
                        255
                    };
            }
        }
        3 => {
            let pal = palette.ok_or_else(|| "Indexed PNG (colorType 3) missing PLTE chunk".to_string())?;
            for i in 0..(width * height) {
                let idx = raw_scanlines[i] as usize;
                let p_offset = idx * 3;
                rgba[i * 4] = if p_offset < pal.len() { pal[p_offset] } else { 0 };
                rgba[i * 4 + 1] = if p_offset + 1 < pal.len() {
                    pal[p_offset + 1]
                } else {
                    0
                };
                rgba[i * 4 + 2] = if p_offset + 2 < pal.len() {
                    pal[p_offset + 2]
                } else {
                    0
                };
                rgba[i * 4 + 3] = if let Some(ref t) = trns {
                    if idx < t.len() {
                        t[idx]
                    } else {
                        255
                    }
                } else {
                    255
                };
            }
        }
        4 => {
            for i in 0..(width * height) {
                let v = raw_scanlines[i * 2];
                let a = raw_scanlines[i * 2 + 1];
                rgba[i * 4] = v;
                rgba[i * 4 + 1] = v;
                rgba[i * 4 + 2] = v;
                rgba[i * 4 + 3] = a;
            }
        }
        0 => {
            for i in 0..(width * height) {
                let v = raw_scanlines[i];
                rgba[i * 4] = v;
                rgba[i * 4 + 1] = v;
                rgba[i * 4 + 2] = v;
                rgba[i * 4 + 3] = 255;
            }
        }
        _ => {}
    }

    Ok(DecodedPng {
        width,
        height,
        bit_depth,
        color_type,
        rgba,
    })
}

fn make_chunk(chunk_type: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(12 + data.len());
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(chunk_type);
    out.extend_from_slice(data);
    let mut hasher = crc32fast::Hasher::new();
    hasher.update(chunk_type);
    hasher.update(data);
    let crc = hasher.finalize();
    out.extend_from_slice(&crc.to_be_bytes());
    out
}

pub fn encode_rgba_to_png(width: usize, height: usize, rgba: &[u8]) -> Result<Vec<u8>, String> {
    if rgba.len() != width * height * 4 {
        return Err(format!(
            "Invalid RGBA buffer length: expected {}, got {}",
            width * height * 4,
            rgba.len()
        ));
    }

    let mut ihdr = [0u8; 13];
    ihdr[0..4].copy_from_slice(&(width as u32).to_be_bytes());
    ihdr[4..8].copy_from_slice(&(height as u32).to_be_bytes());
    ihdr[8] = 8; // bitDepth = 8
    ihdr[9] = 6; // colorType = 6 (RGBA)
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    let stride = width * 4;
    let mut raw_data = vec![0u8; height * (1 + stride)];
    for y in 0..height {
        let row_start = y * (1 + stride);
        raw_data[row_start] = 0; // Filter type 0 (None)
        raw_data[row_start + 1..row_start + 1 + stride]
            .copy_from_slice(&rgba[y * stride..(y + 1) * stride]);
    }

    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(&raw_data)
        .map_err(|e| format!("Zlib compression failed: {}", e))?;
    let compressed = encoder
        .finish()
        .map_err(|e| format!("Zlib finish failed: {}", e))?;

    let mut out = Vec::new();
    out.extend_from_slice(&PNG_SIGNATURE);
    out.extend_from_slice(&make_chunk(b"IHDR", &ihdr));
    out.extend_from_slice(&make_chunk(b"IDAT", &compressed));
    out.extend_from_slice(&make_chunk(b"IEND", &[]));
    Ok(out)
}

pub fn get_tile_bounding_box(
    rgba: &[u8],
    sheet_width: usize,
    tile_x: usize,
    tile_y: usize,
    tile_w: usize,
    tile_h: usize,
) -> BoundingBox {
    let mut min_x = tile_w as i32;
    let mut min_y = tile_h as i32;
    let mut max_x = -1i32;
    let mut max_y = -1i32;
    let mut opaque_count = 0usize;
    let mut sum_x = 0usize;

    for y in 0..tile_h {
        for x in 0..tile_w {
            let idx = ((tile_y + y) * sheet_width + (tile_x + x)) * 4;
            if idx + 3 < rgba.len() && rgba[idx + 3] >= 128 {
                let xi = x as i32;
                let yi = y as i32;
                if xi < min_x {
                    min_x = xi;
                }
                if yi < min_y {
                    min_y = yi;
                }
                if xi > max_x {
                    max_x = xi;
                }
                if yi > max_y {
                    max_y = yi;
                }
                opaque_count += 1;
                sum_x += x;
            }
        }
    }

    if opaque_count == 0 {
        return BoundingBox {
            min_x: 0,
            min_y: 0,
            max_x: -1,
            max_y: -1,
            opaque_count: 0,
            center_x: tile_w as f64 / 2.0,
            bottom_y: (tile_h.saturating_sub(1)) as f64,
        };
    }

    BoundingBox {
        min_x,
        min_y,
        max_x,
        max_y,
        opaque_count,
        center_x: sum_x as f64 / opaque_count as f64,
        bottom_y: max_y as f64,
    }
}

fn gcd(a: usize, b: usize) -> usize {
    let mut x = a;
    let mut y = b;
    while y != 0 {
        let t = y;
        y = x % y;
        x = t;
    }
    x
}

pub fn normalize_to_horizontal_strip(
    source: &DecodedPng,
    target_frames: usize,
    tile_size: usize,
    atlas_frames: Option<&[FrameRect]>,
) -> Result<Vec<u8>, String> {
    let mut src_rgba = source.rgba.clone();

    let mut transparent_pixels = 0usize;
    for i in (3..src_rgba.len()).step_by(4) {
        if src_rgba[i] < 128 {
            transparent_pixels += 1;
        }
    }
    if transparent_pixels == 0 && src_rgba.len() >= 4 {
        let bg_r = src_rgba[0] as i32;
        let bg_g = src_rgba[1] as i32;
        let bg_b = src_rgba[2] as i32;
        for i in (0..src_rgba.len()).step_by(4) {
            let dr = (src_rgba[i] as i32 - bg_r).abs();
            let dg = (src_rgba[i + 1] as i32 - bg_g).abs();
            let db = (src_rgba[i + 2] as i32 - bg_b).abs();
            if dr + dg + db < 24 {
                src_rgba[i] = 0;
                src_rgba[i + 1] = 0;
                src_rgba[i + 2] = 0;
                src_rgba[i + 3] = 0;
            }
        }
    }

    let mut rects: Vec<FrameRect> = Vec::new();
    if let Some(af) = atlas_frames {
        if !af.is_empty() {
            rects.extend_from_slice(af);
        }
    }
    if rects.is_empty() {
        if source.width >= source.height && source.height > 0 && source.width % source.height == 0 {
            let count = (source.width / source.height).max(1);
            let fw = source.width / count;
            let fh = source.height;
            for i in 0..count {
                rects.push(FrameRect {
                    x: i * fw,
                    y: 0,
                    w: fw,
                    h: fh,
                });
            }
        } else if target_frames > 0
            && source.width % target_frames == 0
            && source.height <= source.width
        {
            let fw = source.width / target_frames;
            for i in 0..target_frames {
                rects.push(FrameRect {
                    x: i * fw,
                    y: 0,
                    w: fw,
                    h: source.height,
                });
            }
        } else {
            let g = gcd(source.width, source.height);
            let cell_size = if g >= 32 {
                g
            } else {
                source.width.min(source.height).max(1)
            };
            let cols = (source.width / cell_size).max(1);
            let rows = (source.height / cell_size).max(1);
            for r in 0..rows {
                for c in 0..cols {
                    rects.push(FrameRect {
                        x: c * cell_size,
                        y: r * cell_size,
                        w: cell_size,
                        h: cell_size,
                    });
                }
            }
        }
    }

    let non_empty: Vec<FrameRect> = rects
        .iter()
        .copied()
        .filter(|rect| {
            let b = get_tile_bounding_box(&src_rgba, source.width, rect.x, rect.y, rect.w, rect.h);
            b.opaque_count > 0
        })
        .collect();
    let usable = if !non_empty.is_empty() {
        non_empty
    } else {
        rects
    };

    let mut selected_rects = Vec::with_capacity(target_frames);
    for i in 0..target_frames {
        let idx = if target_frames == 1 {
            0
        } else {
            ((i * usable.len()) / target_frames).min(usable.len().saturating_sub(1))
        };
        selected_rects.push(usable[idx]);
    }

    let scaled_tiles: Vec<Vec<u8>> = selected_rects
        .iter()
        .map(|rect| {
            let mut tile = vec![0u8; tile_size * tile_size * 4];
            for y in 0..tile_size {
                let src_y = ((y * rect.h) / tile_size).min(rect.h.saturating_sub(1));
                for x in 0..tile_size {
                    let src_x = ((x * rect.w) / tile_size).min(rect.w.saturating_sub(1));
                    let src_idx = ((rect.y + src_y) * source.width + (rect.x + src_x)) * 4;
                    let dst_idx = (y * tile_size + x) * 4;
                    if src_idx + 3 < src_rgba.len() && src_rgba[src_idx + 3] >= 128 {
                        tile[dst_idx] = src_rgba[src_idx];
                        tile[dst_idx + 1] = src_rgba[src_idx + 1];
                        tile[dst_idx + 2] = src_rgba[src_idx + 2];
                        tile[dst_idx + 3] = 255;
                    }
                }
            }
            tile
        })
        .collect();

    let boxes: Vec<BoundingBox> = scaled_tiles
        .iter()
        .map(|t| get_tile_bounding_box(t, tile_size, 0, 0, tile_size, tile_size))
        .collect();
    let valid_boxes: Vec<&BoundingBox> = boxes.iter().filter(|b| b.opaque_count > 0).collect();

    let target_center_x = if !valid_boxes.is_empty() {
        (valid_boxes.iter().map(|b| b.center_x).sum::<f64>() / valid_boxes.len() as f64).round()
            as i32
    } else {
        (tile_size / 2) as i32
    };
    let target_bottom_y = if !valid_boxes.is_empty() {
        (valid_boxes.iter().map(|b| b.bottom_y).sum::<f64>() / valid_boxes.len() as f64).round()
            as i32
    } else {
        (tile_size.saturating_sub(6)) as i32
    };

    let out_width = target_frames * tile_size;
    let out_height = tile_size;
    let mut out_rgba = vec![0u8; out_width * out_height * 4];

    for f in 0..target_frames {
        let tile = &scaled_tiles[f];
        let b = &boxes[f];
        let raw_shift_x = target_center_x - b.center_x.round() as i32;
        let raw_shift_y = target_bottom_y - b.bottom_y.round() as i32;
        let shift_x = if raw_shift_x.abs() > 4 { raw_shift_x } else { 0 };
        let shift_y = if raw_shift_y.abs() > 4 { raw_shift_y } else { 0 };

        for y in 0..tile_size {
            for x in 0..tile_size {
                let dst_x = x as i32 + shift_x;
                let dst_y = y as i32 + shift_y;
                if dst_x < 0
                    || dst_x >= tile_size as i32
                    || dst_y < 0
                    || dst_y >= tile_size as i32
                {
                    continue;
                }
                let src_idx = (y * tile_size + x) * 4;
                if tile[src_idx + 3] == 0 {
                    continue;
                }
                let out_idx =
                    (dst_y as usize * out_width + (f * tile_size + dst_x as usize)) * 4;
                out_rgba[out_idx] = tile[src_idx];
                out_rgba[out_idx + 1] = tile[src_idx + 1];
                out_rgba[out_idx + 2] = tile[src_idx + 2];
                out_rgba[out_idx + 3] = 255;
            }
        }
    }

    encode_rgba_to_png(out_width, out_height, &out_rgba)
}

#[derive(Clone, Copy, Debug)]
pub struct PetColorPalette {
    pub primary: [u8; 3],
    pub secondary: [u8; 3],
    pub belly: [u8; 3],
    pub outline: [u8; 3],
    pub eye: [u8; 3],
    pub accent: [u8; 3],
}

pub fn default_species_palette(species: &str) -> PetColorPalette {
    match species {
        "cat" => PetColorPalette {
            primary: [148, 156, 172],
            secondary: [102, 110, 128],
            belly: [238, 240, 245],
            outline: [38, 42, 54],
            eye: [72, 180, 108],
            accent: [236, 144, 164],
        },
        "rabbit" => PetColorPalette {
            primary: [242, 236, 232],
            secondary: [212, 198, 192],
            belly: [255, 252, 250],
            outline: [72, 58, 56],
            eye: [188, 52, 76],
            accent: [244, 168, 184],
        },
        "hamster" => PetColorPalette {
            primary: [238, 182, 108],
            secondary: [196, 136, 68],
            belly: [252, 244, 232],
            outline: [68, 44, 24],
            eye: [28, 22, 22],
            accent: [240, 152, 164],
        },
        "bird" => PetColorPalette {
            primary: [76, 178, 232],
            secondary: [44, 128, 188],
            belly: [240, 248, 255],
            outline: [24, 48, 72],
            eye: [24, 24, 28],
            accent: [250, 188, 56],
        },
        "fox" => PetColorPalette {
            primary: [232, 108, 44],
            secondary: [176, 68, 20],
            belly: [250, 242, 234],
            outline: [48, 24, 16],
            eye: [42, 32, 18],
            accent: [52, 44, 44],
        },
        "other" => PetColorPalette {
            primary: [132, 198, 126],
            secondary: [86, 152, 84],
            belly: [228, 246, 224],
            outline: [32, 58, 34],
            eye: [28, 28, 36],
            accent: [244, 196, 78],
        },
        _ => PetColorPalette {
            primary: [230, 168, 72],
            secondary: [184, 120, 40],
            belly: [250, 232, 196],
            outline: [52, 34, 20],
            eye: [32, 24, 20],
            accent: [224, 92, 92],
        },
    }
}

pub fn extract_palette_from_rgba_samples(
    samples: &[(usize, usize, Vec<u8>)],
    species: &str,
) -> PetColorPalette {
    let fallback = default_species_palette(species);
    if samples.is_empty() {
        return fallback;
    }

    let mut buckets: HashMap<u32, (usize, u64, u64, u64)> = HashMap::new();

    for (width, height, rgba) in samples {
        if *width == 0 || *height == 0 {
            continue;
        }
        let start_x = (*width as f64 * 0.2).floor() as usize;
        let end_x = ((*width as f64 * 0.8).floor() as usize).max(start_x + 1);
        let start_y = (*height as f64 * 0.2).floor() as usize;
        let end_y = ((*height as f64 * 0.8).floor() as usize).max(start_y + 1);
        let step_x = ((end_x - start_x) / 32).max(1);
        let step_y = ((end_y - start_y) / 32).max(1);

        for y in (start_y..end_y).step_by(step_y) {
            for x in (start_x..end_x).step_by(step_x) {
                let idx = (y * *width + x) * 4;
                if idx + 3 >= rgba.len() {
                    continue;
                }
                let r = rgba[idx];
                let g = rgba[idx + 1];
                let b = rgba[idx + 2];
                let a = rgba[idx + 3];
                if a < 128 {
                    continue;
                }
                let lum = 0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64;
                if !(18.0..=245.0).contains(&lum) {
                    continue;
                }
                let key = (((r >> 4) as u32) << 8) | (((g >> 4) as u32) << 4) | ((b >> 4) as u32);
                let entry = buckets.entry(key).or_insert((0, 0, 0, 0));
                entry.0 += 1;
                entry.1 += r as u64;
                entry.2 += g as u64;
                entry.3 += b as u64;
            }
        }
    }

    if buckets.is_empty() {
        return fallback;
    }

    let top = buckets
        .values()
        .max_by_key(|v| v.0)
        .copied()
        .unwrap_or((1, 230, 168, 72));
    let count = top.0.max(1) as f64;
    let primary = [
        (top.1 as f64 / count).round().clamp(0.0, 255.0) as u8,
        (top.2 as f64 / count).round().clamp(0.0, 255.0) as u8,
        (top.3 as f64 / count).round().clamp(0.0, 255.0) as u8,
    ];
    let secondary = [
        (primary[0] as f64 * 0.76).round().clamp(0.0, 255.0) as u8,
        (primary[1] as f64 * 0.76).round().clamp(0.0, 255.0) as u8,
        (primary[2] as f64 * 0.76).round().clamp(0.0, 255.0) as u8,
    ];
    let belly = [
        (primary[0] as f64 + (255.0 - primary[0] as f64) * 0.62)
            .round()
            .clamp(0.0, 255.0) as u8,
        (primary[1] as f64 + (255.0 - primary[1] as f64) * 0.62)
            .round()
            .clamp(0.0, 255.0) as u8,
        (primary[2] as f64 + (255.0 - primary[2] as f64) * 0.62)
            .round()
            .clamp(0.0, 255.0) as u8,
    ];
    let outline = [
        (primary[0] as f64 * 0.28).round().clamp(12.0, 255.0) as u8,
        (primary[1] as f64 * 0.28).round().clamp(12.0, 255.0) as u8,
        (primary[2] as f64 * 0.28).round().clamp(12.0, 255.0) as u8,
    ];

    PetColorPalette {
        primary,
        secondary,
        belly,
        outline,
        eye: fallback.eye,
        accent: fallback.accent,
    }
}

fn set_pixel(
    buf: &mut [u8],
    sheet_width: usize,
    tile_offset_x: usize,
    x: i32,
    y: i32,
    color: [u8; 3],
) {
    if !(0..64).contains(&x) || !(0..64).contains(&y) {
        return;
    }
    let idx = (y as usize * sheet_width + (tile_offset_x + x as usize)) * 4;
    if idx + 3 < buf.len() {
        buf[idx] = color[0];
        buf[idx + 1] = color[1];
        buf[idx + 2] = color[2];
        buf[idx + 3] = 255;
    }
}

fn fill_rect(
    buf: &mut [u8],
    sheet_width: usize,
    tile_offset_x: usize,
    x0: i32,
    y0: i32,
    w: i32,
    h: i32,
    color: [u8; 3],
) {
    for dy in 0..h {
        for dx in 0..w {
            set_pixel(buf, sheet_width, tile_offset_x, x0 + dx, y0 + dy, color);
        }
    }
}

fn draw_outlined_box(
    buf: &mut [u8],
    sheet_width: usize,
    tile_offset_x: usize,
    x0: i32,
    y0: i32,
    w: i32,
    h: i32,
    fill: [u8; 3],
    outline: [u8; 3],
) {
    fill_rect(buf, sheet_width, tile_offset_x, x0, y0, w, h, outline);
    if w > 2 && h > 2 {
        fill_rect(buf, sheet_width, tile_offset_x, x0 + 1, y0 + 1, w - 2, h - 2, fill);
    }
}

fn draw_pet_frame(
    buf: &mut [u8],
    sheet_width: usize,
    tile_offset_x: usize,
    species: &str,
    palette: &PetColorPalette,
    anim: &str,
    frame_index: usize,
    total_frames: usize,
) {
    let is_dead_frame = anim == "death" && frame_index == total_frames.saturating_sub(1);
    let is_dying_mid = anim == "death" && frame_index == 1;
    let is_hurt = anim == "hurt";
    let is_attack = anim == "attack";
    let is_evolve = anim == "evolution";

    let bob_y = match anim {
        "idle" => if frame_index % 2 == 1 { -1 } else { 0 },
        "walk" => if frame_index % 2 == 1 { -2 } else { 0 },
        "hurt" => if frame_index % 2 == 1 { 1 } else { -1 },
        "attack" => if frame_index == 1 || frame_index == 2 { -3 } else { 0 },
        "evolution" => if (2..=5).contains(&frame_index) { -3 } else { 0 },
        _ => {
            if is_dying_mid {
                3
            } else if is_dead_frame {
                7
            } else {
                0
            }
        }
    };

    let lunge_x = match anim {
        "attack" => {
            if frame_index == 1 {
                3
            } else if frame_index == 2 {
                4
            } else {
                0
            }
        }
        "hurt" => {
            if frame_index == 0 {
                -2
            } else {
                2
            }
        }
        _ => 0,
    };

    let cx = 32 + lunge_x;
    let ground_y = 54;

    if is_dead_frame {
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            cx - 15,
            ground_y - 12,
            30,
            12,
            palette.primary,
            palette.outline,
        );
        fill_rect(
            buf,
            sheet_width,
            tile_offset_x,
            cx - 10,
            ground_y - 7,
            18,
            5,
            palette.belly,
        );
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            cx + 6,
            ground_y - 16,
            14,
            13,
            palette.primary,
            palette.outline,
        );
        set_pixel(buf, sheet_width, tile_offset_x, cx + 11, ground_y - 11, palette.outline);
        set_pixel(buf, sheet_width, tile_offset_x, cx + 13, ground_y - 9, palette.outline);
        set_pixel(buf, sheet_width, tile_offset_x, cx + 13, ground_y - 11, palette.outline);
        set_pixel(buf, sheet_width, tile_offset_x, cx + 11, ground_y - 9, palette.outline);
        fill_rect(buf, sheet_width, tile_offset_x, cx + 15, ground_y - 6, 3, 3, palette.accent);
        return;
    }

    let body_w = if species == "hamster" || species == "bird" {
        22
    } else {
        24
    };
    let body_h = if species == "hamster" { 18 } else { 16 };
    let body_x = cx - (body_w / 2);
    let body_y = ground_y - 6 - body_h + bob_y;

    let tail_wag = if frame_index % 2 == 0 { 0 } else { -2 };
    if species == "fox" {
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            body_x - 9,
            body_y + 2 + tail_wag,
            10,
            9,
            palette.primary,
            palette.outline,
        );
        fill_rect(
            buf,
            sheet_width,
            tile_offset_x,
            body_x - 8,
            body_y + 3 + tail_wag,
            4,
            4,
            palette.belly,
        );
    } else if species == "rabbit" || species == "hamster" {
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            body_x - 4,
            body_y + 8,
            5,
            5,
            palette.belly,
            palette.outline,
        );
    } else if species == "bird" {
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            body_x - 6,
            body_y + 8 + tail_wag,
            7,
            5,
            palette.secondary,
            palette.outline,
        );
    } else {
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            body_x - 6,
            body_y + 3 + tail_wag,
            7,
            8,
            palette.secondary,
            palette.outline,
        );
    }

    let walk_step = if anim == "walk" { frame_index % 4 } else { 0 };
    let left_leg_lift = if walk_step == 1 {
        -2
    } else if walk_step == 3 {
        1
    } else {
        0
    };
    let right_leg_lift = if walk_step == 3 {
        -2
    } else if walk_step == 1 {
        1
    } else {
        0
    };

    draw_outlined_box(
        buf,
        sheet_width,
        tile_offset_x,
        body_x + 3,
        ground_y - 7 + left_leg_lift.min(0),
        5,
        7 - left_leg_lift.min(0),
        palette.secondary,
        palette.outline,
    );
    draw_outlined_box(
        buf,
        sheet_width,
        tile_offset_x,
        body_x + body_w - 8,
        ground_y - 7 + right_leg_lift.min(0),
        5,
        7 - right_leg_lift.min(0),
        palette.secondary,
        palette.outline,
    );

    draw_outlined_box(
        buf,
        sheet_width,
        tile_offset_x,
        body_x,
        body_y,
        body_w,
        body_h,
        palette.primary,
        palette.outline,
    );
    fill_rect(
        buf,
        sheet_width,
        tile_offset_x,
        body_x + 4,
        body_y + 4,
        body_w - 8,
        body_h - 6,
        palette.belly,
    );
    fill_rect(
        buf,
        sheet_width,
        tile_offset_x,
        body_x + 3,
        body_y + 1,
        body_w - 6,
        2,
        palette.accent,
    );

    let head_w = 22;
    let head_h = 17;
    let head_x = cx - (head_w / 2) + if anim == "walk" || is_attack { 1 } else { 0 };
    let head_y = body_y - head_h + 4;

    if species == "rabbit" {
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + 3,
            head_y - 10,
            5,
            11,
            palette.primary,
            palette.outline,
        );
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + head_w - 8,
            head_y - 10,
            5,
            11,
            palette.primary,
            palette.outline,
        );
        fill_rect(buf, sheet_width, tile_offset_x, head_x + 5, head_y - 8, 2, 7, palette.accent);
        fill_rect(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + head_w - 6,
            head_y - 8,
            2,
            7,
            palette.accent,
        );
    } else if species == "cat" || species == "fox" {
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + 1,
            head_y - 5,
            6,
            6,
            palette.secondary,
            palette.outline,
        );
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + head_w - 7,
            head_y - 5,
            6,
            6,
            palette.secondary,
            palette.outline,
        );
        fill_rect(buf, sheet_width, tile_offset_x, head_x + 3, head_y - 3, 2, 3, palette.accent);
        fill_rect(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + head_w - 5,
            head_y - 3,
            2,
            3,
            palette.accent,
        );
    } else if species == "dog" {
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            head_x - 2,
            head_y + 1,
            5,
            8,
            palette.secondary,
            palette.outline,
        );
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + head_w - 3,
            head_y + 1,
            5,
            8,
            palette.secondary,
            palette.outline,
        );
    } else if species == "hamster" {
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + 1,
            head_y - 3,
            5,
            5,
            palette.secondary,
            palette.outline,
        );
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + head_w - 6,
            head_y - 3,
            5,
            5,
            palette.secondary,
            palette.outline,
        );
    } else if species == "bird" {
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + 8,
            head_y - 5,
            6,
            6,
            palette.secondary,
            palette.outline,
        );
    } else {
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + 2,
            head_y - 4,
            5,
            5,
            palette.secondary,
            palette.outline,
        );
        draw_outlined_box(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + head_w - 7,
            head_y - 4,
            5,
            5,
            palette.secondary,
            palette.outline,
        );
    }

    draw_outlined_box(
        buf,
        sheet_width,
        tile_offset_x,
        head_x,
        head_y,
        head_w,
        head_h,
        palette.primary,
        palette.outline,
    );
    fill_rect(
        buf,
        sheet_width,
        tile_offset_x,
        head_x + 4,
        head_y + 9,
        head_w - 8,
        6,
        palette.belly,
    );

    if is_hurt || is_dying_mid {
        set_pixel(buf, sheet_width, tile_offset_x, head_x + 5, head_y + 6, palette.outline);
        set_pixel(buf, sheet_width, tile_offset_x, head_x + 6, head_y + 7, palette.outline);
        set_pixel(buf, sheet_width, tile_offset_x, head_x + 5, head_y + 8, palette.outline);
        set_pixel(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + head_w - 6,
            head_y + 6,
            palette.outline,
        );
        set_pixel(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + head_w - 7,
            head_y + 7,
            palette.outline,
        );
        set_pixel(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + head_w - 6,
            head_y + 8,
            palette.outline,
        );
    } else {
        fill_rect(buf, sheet_width, tile_offset_x, head_x + 5, head_y + 6, 3, 3, palette.eye);
        fill_rect(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + head_w - 8,
            head_y + 6,
            3,
            3,
            palette.eye,
        );
        set_pixel(buf, sheet_width, tile_offset_x, head_x + 5, head_y + 6, [255, 255, 255]);
        set_pixel(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + head_w - 8,
            head_y + 6,
            [255, 255, 255],
        );
    }

    if species == "bird" {
        fill_rect(buf, sheet_width, tile_offset_x, head_x + 9, head_y + 9, 4, 3, palette.accent);
    } else {
        fill_rect(buf, sheet_width, tile_offset_x, head_x + 10, head_y + 9, 3, 2, palette.outline);
        if is_attack || (anim == "idle" && frame_index == 2) {
            fill_rect(
                buf,
                sheet_width,
                tile_offset_x,
                head_x + 10,
                head_y + 11,
                3,
                2,
                palette.accent,
            );
        }
    }

    if is_attack && (frame_index == 1 || frame_index == 2) {
        let spark_color = [255, 224, 92];
        fill_rect(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + head_w + 2,
            head_y + 2,
            3,
            3,
            spark_color,
        );
        fill_rect(
            buf,
            sheet_width,
            tile_offset_x,
            head_x + head_w + 4,
            head_y + 8,
            2,
            2,
            palette.accent,
        );
    }

    if is_evolve {
        let gold = [255, 218, 72];
        if (1..=6).contains(&frame_index) {
            set_pixel(buf, sheet_width, tile_offset_x, head_x - 3, head_y + 3, gold);
            set_pixel(
                buf,
                sheet_width,
                tile_offset_x,
                head_x + head_w + 2,
                head_y + 3,
                gold,
            );
            set_pixel(buf, sheet_width, tile_offset_x, body_x - 2, body_y + 6, gold);
            set_pixel(
                buf,
                sheet_width,
                tile_offset_x,
                body_x + body_w + 1,
                body_y + 6,
                gold,
            );
        }
        if frame_index >= 4 {
            fill_rect(buf, sheet_width, tile_offset_x, head_x + 9, head_y + 2, 4, 3, gold);
        }
    }
}

pub fn synthesize_all_animations(
    species: &str,
    palette: &PetColorPalette,
) -> Result<HashMap<String, Vec<u8>>, String> {
    let specs = [
        ("idle", 4usize),
        ("walk", 6usize),
        ("hurt", 2usize),
        ("death", 3usize),
        ("attack", 4usize),
        ("evolution", 8usize),
    ];
    let mut result = HashMap::new();
    for (key, frames) in specs {
        let width = frames * 64;
        let height = 64;
        let mut rgba = vec![0u8; width * height * 4];
        for f in 0..frames {
            draw_pet_frame(&mut rgba, width, f * 64, species, palette, key, f, frames);
        }
        let encoded = encode_rgba_to_png(width, height, &rgba)?;
        result.insert(key.to_string(), encoded);
    }
    Ok(result)
}
