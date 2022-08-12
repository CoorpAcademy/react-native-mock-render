import React from 'react';
import PropTypes from 'prop-types';
import createReactClass from 'create-react-class';
import createMockComponent from './createMockComponent';

const TabBarIOS = createReactClass({
  displayName: 'TabBarIOS',
  propTypes: {
    children: PropTypes.node
  },
  statics: {
    Item: createMockComponent('TabBarIOS.Item')
  },
  render() {
    return React.createElement('react-native-mock', this.props, this.props.children);
  }
});

module.exports = TabBarIOS;
