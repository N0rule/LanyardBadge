#!/usr/bin/env python3
"""Package static site and per-commit firmware manifests without filesystem images."""
import argparse, hashlib, json, re, shutil, subprocess, struct
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', default='test-results/site')
args = p.parse_args()
out = ROOT / args.output
out.mkdir(parents=True, exist_ok=True)
shutil.copytree(ROOT/'web', out, dirs_exist_ok=True)
revision = subprocess.check_output(['git','rev-parse','--short=12','HEAD'], cwd=ROOT, text=True).strip()
version = '2.3.0-' + revision
# Pages caches static assets. A new index must not load an older BLE transport.
index = out/'index.html'
index.write_text(re.sub(r'((?:src|href)="\./[^"?]+\.(?:js|css))(")',
                       lambda match: match[1]+'?v='+revision+match[2], index.read_text()))
firmware = out/'firmware'
build = ROOT/'.pio/build/cyd2usb'
versioned = firmware/version
versioned.mkdir(parents=True, exist_ok=True)
parts = [('bootloader.bin',4096),('partitions.bin',32768),('firmware.bin',65536)]
for name, _ in parts:
    shutil.copyfile(build/name, versioned/name)
assert (versioned/'firmware.bin').stat().st_size <= 0x200000
# Validate the compiled layout, not just the source CSV.
entries=[]
data=(versioned/'partitions.bin').read_bytes()
for at in range(0,len(data),32):
    if data[at:at+2]!=b'\xaaP': break
    _,kind,subtype,offset,size,label,_=struct.unpack('<HBBII16sI',data[at:at+32])
    entries.append((label.rstrip(b'\0').decode(),offset,size))
assert ('factory',0x10000,0x200000) in entries
assert ('assets',0x210000,0x1f0000) in entries
for mode, selected in [('fresh',parts),('update',[parts[-1]])]:
    manifest={'name':'LanyardBadge CYD2USB','version':version,
              'new_install_prompt_erase':True,'new_install_skip_erase':True,
              'builds':[{'chipFamily':'ESP32','parts':[{'path':version+'/'+name,'offset':offset} for name,offset in selected]}]}
    (firmware/(mode+'.json')).write_text(json.dumps(manifest,indent=2)+'\n')
    (versioned/(mode+'.json')).write_text(json.dumps({**manifest,'builds':[{'chipFamily':'ESP32','parts':[{'path':name,'offset':offset} for name,offset in selected]}]},indent=2)+'\n')
(versioned/'SHA256SUMS').write_text(''.join(hashlib.sha256((versioned/name).read_bytes()).hexdigest()+'  '+name+'\n' for name,_ in parts))
(out/'.nojekyll').touch()
print(f'Packaged {version}: {out}')
