from PIL import Image

img = Image.open("src/assets/Idle.png")
frame = img.crop((0, 0, 48, 48))
frame.save("Dog_Base_48.png")
print("Dog_Base_48.png saved — 48x48")
