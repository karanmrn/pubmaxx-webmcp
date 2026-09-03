def lin(c):
    c/=255
    return c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
def L(hexs):
    h=hexs.lstrip('#'); r,g,b=int(h[0:2],16),int(h[2:4],16),int(h[4:6],16)
    return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b)
def ratio(a,b):
    la,lb=L(a),L(b); hi,lo=max(la,lb),min(la,lb)
    return (hi+0.05)/(lo+0.05)
pairs = [
 ("LIGHT ink/paper","#17171a","#faf8f5"),
 ("LIGHT ink/panel","#17171a","#f5f2ef"),
 ("LIGHT ink/panel-raised","#17171a","#fffdfb"),
 ("LIGHT ink-soft/paper","#3f3f46","#faf8f5"),
 ("LIGHT ink-soft/panel","#3f3f46","#f5f2ef"),
 ("LIGHT muted/paper","#6b6b73","#faf8f5"),
 ("LIGHT muted/panel","#6b6b73","#f5f2ef"),
 ("LIGHT muted/panel-raised","#6b6b73","#fffdfb"),
 ("DARK ink/paper","#eef3ef","#0a0a0b"),
 ("DARK ink/panel","#eef3ef","#141416"),
 ("DARK ink/panel-raised","#eef3ef","#1c1c1f"),
 ("DARK ink-soft/paper","#c9c9ce","#0a0a0b"),
 ("DARK ink-soft/panel","#c9c9ce","#141416"),
 ("DARK muted/paper","#9a9aa0","#0a0a0b"),
 ("DARK muted/panel","#9a9aa0","#141416"),
 ("DARK muted/panel-raised","#9a9aa0","#1c1c1f"),
 ("DARK muted/panel-overlay","#9a9aa0","#242427"),
 # accents / on-accent
 ("LIGHT on-accent/brass","#fdfaf2","#ff5a5f"),
 ("LIGHT amber/paper","#f2a71b","#faf8f5"),
 ("LIGHT pint/paper","#18a76d","#faf8f5"),
 ("LIGHT brick/paper","#ff5a5f","#faf8f5"),
 ("DARK amber/paper","#f0a01a","#0a0a0b"),
 ("DARK pint/paper","#5fb389","#0a0a0b"),
]
for name,a,b in pairs:
    r=ratio(a,b)
    aa = "AA-pass" if r>=4.5 else ("AA-large-only" if r>=3 else "FAIL")
    print(f"{r:5.2f}:1  {aa:14} {name}")
