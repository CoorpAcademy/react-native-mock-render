const {JSDOM} = require('jsdom');

const jsdom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost'
});
const {window} = jsdom;

function copyProps(src, target) {
  const props = Object.getOwnPropertyNames(src)
    .filter((prop) => typeof target[prop] === 'undefined')
    .map((prop) => Object.getOwnPropertyDescriptor(src, prop));
  Object.defineProperties(target, props);
}

global.window = window;
global.document = window.document;
global.navigator = {
  userAgent: 'node.js'
};
copyProps(window, global);

// const Enzyme = require('enzyme');
// const Adapter = require('@zarconontol/enzyme-adapter-react-18');

// Enzyme.configure({adapter: new Adapter()});
