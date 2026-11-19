const assert=require('node:assert/strict');
const {routeDescription}=require('../web/app.js');
assert.equal(routeDescription({description:' Capitol Hill – Ballard ',long_name:'Other'}),'Capitol Hill – Ballard');
assert.equal(routeDescription({description:' ',long_name:'Downtown – Waterfront'}),'Downtown – Waterfront');
assert.equal(routeDescription({name:'49'}),'Route description and major destinations are unavailable.');
assert.equal(routeDescription(null),routeDescription({}));
console.log('Catalog description, destination wording, fallback and absent metadata passed');
