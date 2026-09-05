from PIL import Image

# 1. Open the original sprite sheet
# (Make sure this path points to where your Idle.png is)
img = Image.open("src/assets/Idle.png")

# 2. Crop just the first frame (the first 48x48 square)
# The box is (left, upper, right, lower)
first_frame = img.crop((0, 0, 48, 48))

# 3. Scale it up by 16x (to 768x768) using NEAREST neighbor (keeps pixels sharp!)
big_dog = first_frame.resize((768, 768), Image.Resampling.NEAREST)

# 4. Save the new big image ready for Runware!
big_dog.save("Dog_Big.png")
print("Dog_Big.png has been created successfully!")
