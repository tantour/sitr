# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Sitr contributors
"""Translate the pinned official BodyPix MobileNet dense heads to ONNX.
No retraining; drops pose/offset branches, keeps person and 24-part logits.
Inputs and output artifacts are pinned in models/artifacts.json; browser parity was checked.
"""
from pathlib import Path
import json, hashlib
import numpy as np
import onnx
from onnx import helper as h, numpy_helper as nh, TensorProto as T
root=Path(__file__).resolve().parents[1]
base=root/'models'
inputs=base/'sources'
pins=json.loads((base/'artifacts.json').read_text())
for entry in pins['sourceArtifacts']:
    if entry['name'].startswith('bodypix075-'):
        source=inputs/entry['name']
        assert hashlib.sha256(source.read_bytes()).hexdigest()==entry['sha256'], str(source)

manifest=[]
for variant in ['075','075-s8']:
    folder=inputs
    model_stride=8 if variant.endswith('s8') else 16
    source_json=folder/f'bodypix075-stride{model_stride}.json'
    m=json.loads(source_json.read_text()); weights={}
    for group in m['weightsManifest']:
        raw=(folder/'bodypix075-quant2.bin').read_bytes();offset=0
        for w in group['weights']:
            n=int(np.prod(w['shape']));q=w.get('quantization');dt='<u2' if q and q['dtype']=='uint16' else '<u1' if q else '<f4'
            a=np.frombuffer(raw,dtype=dt,count=n,offset=offset);offset+=n*np.dtype(dt).itemsize
            if q:a=(a.astype(np.float64)*q['scale']+q['min']).astype(np.float32)
            weights[w['name']]=a.reshape(w['shape'])
        assert offset==len(raw)
    defs={n['name']:n for n in m['modelTopology']['node']}
    wanted=['float_segments','float_part_heatmaps'];needed=set()
    def visit(name):
        name=name.split(':')[0]
        if name in needed:return
        needed.add(name)
        for inp in defs[name].get('input',[]):visit(inp)
    for name in wanted:visit(name)
    for side in ([257] if model_stride==16 else [321]):
        nodes=[];init=[];used=set();spatial={'sub_2':(side,side)}
        def const(name,a):
            if name not in used:init.append(nh.from_array(np.asarray(a,dtype=np.float32),name));used.add(name)
            return name
        const('clip-min',np.array(0));const('clip-max',np.array(6))
        for d in m['modelTopology']['node']:
            name=d['name'];op=d['op'];inp=d.get('input',[]);attr=d.get('attr',{})
            if name not in needed or op in ['Const','Placeholder']:continue
            if op in ['Conv2D','DepthwiseConv2dNative']:
                a=weights[inp[1]]
                group=1
                if op=='Conv2D':a=a.transpose(3,2,0,1)
                else:
                    group=a.shape[2];a=a.transpose(2,3,0,1).reshape(-1,1,a.shape[0],a.shape[1])
                wn=const(inp[1]+'/onnx',a)
                stride=[int(x) for x in attr['strides']['list']['i']][1:3]
                dil=[int(x) for x in attr.get('dilations',{'list':{'i':['1']*4}})['list']['i']][1:3]
                padding=attr['padding']['s']
                # GraphDef strings are base64-encoded.
                import base64
                padding=base64.b64decode(padding).decode()
                ih,iw=spatial[inp[0]];eh=(a.shape[2]-1)*dil[0]+1;ew=(a.shape[3]-1)*dil[1]+1
                oh=(ih+stride[0]-1)//stride[0] if padding=='SAME' else (ih-eh)//stride[0]+1
                ow=(iw+stride[1]-1)//stride[1] if padding=='SAME' else (iw-ew)//stride[1]+1
                ph=max(0,(oh-1)*stride[0]+eh-ih) if padding=='SAME' else 0
                pw=max(0,(ow-1)*stride[1]+ew-iw) if padding=='SAME' else 0
                spatial[name]=(oh,ow)
                nodes.append(h.make_node('Conv',[inp[0],wn],[name],name=name,strides=stride,dilations=dil,group=group,pads=[ph//2,pw//2,ph-ph//2,pw-pw//2]))
            elif op=='BiasAdd':
                nodes.append(h.make_node('Add',[inp[0],const(inp[1]+'/onnx',weights[inp[1]].reshape(1,-1,1,1))],[name],name=name));spatial[name]=spatial[inp[0]]
            elif op=='Relu6':
                nodes.append(h.make_node('Clip',[inp[0],'clip-min','clip-max'],[name],name=name));spatial[name]=spatial[inp[0]]
            else:raise ValueError(op)
        outside=(side-1)//(8 if variant.endswith('s8') else 16)+1
        outs=[h.make_tensor_value_info('float_segments',T.FLOAT,[1,1,outside,outside]),h.make_tensor_value_info('float_part_heatmaps',T.FLOAT,[1,24,outside,outside])]
        graph=h.make_graph(nodes,'BodyPix-MobileNet-dense-heads',[h.make_tensor_value_info('sub_2',T.FLOAT,[1,3,side,side])],outs,init)
        model=h.make_model(graph,opset_imports=[h.make_opsetid('',17)],producer_name='Sitr BodyPix dense heads; official Google weights');model.ir_version=10
        onnx.checker.check_model(model)
        path=base/f'bodypix-mobilenet075-stride{model_stride}-{side}.onnx';onnx.save(model,path)
        manifest.append({'file':path.name,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'heads':wanted,'nodes':len(nodes),'sourceJsonSha256':hashlib.sha256(source_json.read_bytes()).hexdigest()})
        print(path.name,path.stat().st_size,flush=True)
(base/'sources/bodypix-exports.json').write_text(json.dumps(manifest,indent=2))
