# -*- coding: utf-8 -*-
text = "α∞σ·/·∙σßσ·"
print("Original string:", type(text))

# Let's inspect the Unicode code points
points = [ord(c) for c in text]
print("Code points:", points)

# Try shifting to match Hebrew Range (1488 - 1514)
# Hebrew א (Aleph) is 1488
print("Trying shifts:")
for shift in range(-2000, 2000):
    shifted = "".join(chr((p + shift) % 0x110000) for p in points)
    # Check if all chars (ignoring punctuation) are in Hebrew range
    hebrew_chars_count = sum(1 for c in shifted if 1488 <= ord(c) <= 1514)
    if hebrew_chars_count >= 5:
        print(f"Shift {shift}: {shifted}")
