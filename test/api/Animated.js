import React from 'react';
import View from '../../src/components/View.js';
import {expect} from 'chai';
import {render} from '@testing-library/react';
import Animated from '../../src/api/Animated';

describe('Animated.View', () => {
  let wrapper;
  let fiberNode;

  beforeEach(() => {
    wrapper = render(
      <Animated.View>
        <View data-testid="child-view" />
      </Animated.View>
    );
  });

  it('renders its children', () => {
    expect(Object.keys(wrapper.getByTestId('child-view'))).to.have.length(2);
  });

  it('implements setNativeProps', () => {
    fiberNode = Object.values(wrapper.getByTestId('child-view'))[0];
    const setNativeProps = fiberNode.return.stateNode.setNativeProps;
    expect(typeof setNativeProps).to.equal('function');
  });
});
