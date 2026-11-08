import test from 'node:test';
import assert from 'node:assert/strict';
import {pickTopFaceHole} from './solidHolePick.ts';

const holes=[
  {id:'holeA',x:20,y:20,radius:5},
  {id:'holeB',x:75,y:40,radius:10},
];
test('top-face hole picking returns only solver-authored semantic IDs',()=>{
  assert.equal(pickTopFaceHole({x:20,y:20},holes),'holeA');
  assert.equal(pickTopFaceHole({x:80,y:40},holes),'holeB');
  assert.equal(pickTopFaceHole({x:25,y:20},holes),'holeA');
  assert.equal(pickTopFaceHole({x:40,y:40},holes),null);
});
test('invalid, invisible and ambiguous markers do not invent geometry',()=>{
  assert.equal(pickTopFaceHole({x:NaN,y:20},holes),null);
  assert.equal(pickTopFaceHole({x:0,y:0},[{id:'bad',x:0,y:0,radius:NaN}]),null);
  assert.equal(pickTopFaceHole({x:0,y:0},[{id:'',x:0,y:0,radius:1}]),null);
  assert.equal(pickTopFaceHole({x:0,y:0},[]),null);
  assert.equal(pickTopFaceHole({x:0,y:0},[
    {id:'wide',x:0,y:0,radius:10},{id:'tight',x:0,y:0.2,radius:0.5},
  ]),'wide');
});
