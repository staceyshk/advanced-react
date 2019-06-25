import { mount } from 'enzyme';
import toJSON from 'enzyme-to-json';
import wait from 'waait';
import Order, { SINGLE_ORDER_QUERY } from '../components/Order';
import { MockedProvider } from 'react-apollo/test-utils';
import { fakeOrder } from '../lib/testUtils';

const mocks = [
  {
    // when someone makes a request with this query and variable combo
    request: { query: SINGLE_ORDER_QUERY, variables: { id: 'ord123' } },
    // return this fake data (mocked data)
    result: {
      data: {
        order: fakeOrder(),
      },
    },
  },
];

describe('<Order />', () => {
  it('renders with proper data', async () => {
    const wrapper = mount(
      <MockedProvider mocks={mocks}>
        <Order id="ord123" />
      </MockedProvider>
    );
    await wait();
    wrapper.update();
    const order = wrapper.find('div[data-test="order"]')
    expect(toJSON(order)).toMatchSnapshot();
  });
});
