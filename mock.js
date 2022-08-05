const createMockComponent = require('./build/components/createMockComponent');
const ReactNativeMock = require('./build/react-native');

const createMock = exports => {
  if (Array.isArray(exports)) {
    return exports.reduce(
      (acc, componentName) => ({
        ...acc,
        [componentName]: createMockComponent(componentName)
      }),
      {}
    );
  } else {
    return createMockComponent(exports);
  }
};

const register = (name, mock) => {
  // the cache key that real lib would get
  const key = require.resolve(name);

  // make sure the cache is filled with our lib
  require.cache[key] = {
    id: key,
    filename: key,
    loaded: true,
    exports: mock
  };
};

const createMocks = options => {
  register('react-native', ReactNativeMock);

  const {externalLibs} = options;

  if (externalLibs) {
    externalLibs.forEach(({name, exports}) => {
      const mock = createMock(exports);
      register(name, mock);
    });
  }
};

module.exports = createMocks;
