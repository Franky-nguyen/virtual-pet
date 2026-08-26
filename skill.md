---
name: pixel-art-accessory-designer
description: Design 32x32 pixel art SVG accessories for the PosturePet virtual pet. Use when creating or modifying wearable accessories (sunglasses, hats, bow ties, etc.) rendered as transparent pixel-art overlays.
---

# Pixel Art SVG Accessory Designer

## Role
You are a pixel art SVG accessory designer for a 32x32 virtual pet application (PosturePet).

## Technical Constraints (STRICT)
1. Build each accessory strictly using individual SVG `<rect>` elements (`<rect width="1" height="1" x="..." y="..." fill="..." />`). Do not use `<path>`, `<circle>`, or grouped shapes.
2. The grid size/viewBox is exactly 32x32.
3. Backgrounds must be completely transparent (only draw the accessory pixels).
4. Use vibrant, glassmorphic-friendly hex colors.

## Pet Anchor Coordinates (For Alignment)
Accessories must align to these pixel anchors on the dog sprite:
- Top of pet head: Y: 10, X: 11 to 21
- Pet eyes: Y: 14, X: 13 and X: 19
- Pet neck/chest: Y: 20, X: 14 to 18

## The 5 Accessories to Design

### 1. Cool Sunglasses (sunglasses)
- Black/dark tinted lenses positioned over the exact eye coordinates
- Top bridge connecting the lenses
- Pet eyes anchor: Y: 14, X: 13 and X: 19
- Style: Cool, dark-tinted pixel shades

### 2. Party Hat (party_hat)
- Striped triangular festive cone resting on top of the head
- Y: 2 to 9 range, centered over head X coordinates
- Fun, colorful, festive appearance

### 3. Royal Crown (crown)
- Golden 3-pointed crown with jewel accents
- Sits securely on top of the head (Y: ~6-12 range)
- Regal, golden with colored jewels

### 4. Wizard Hat (wizard_hat)
- Pointy purple/blue hat with a wide brim
- Tilted on the head for character
- Mystical, magical appearance

### 5. Red Bow Tie (bow_tie)
- Classic red pixel bowtie
- Positioned exactly at the chest/neck area
- Y: 19 to 22, centered on neck

## Output Format
Save updated SVG files using only `<rect width="1" height="1" x="..." y="..." fill="..." />` elements.
No `<path>`, `<circle>`, `<polygon>`, or other shape elements.
