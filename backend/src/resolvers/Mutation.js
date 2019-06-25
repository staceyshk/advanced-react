const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const { randomBytes } = require('crypto');
const { makeANiceEmail, transport } = require('../mail');
const { hasPermission } = require('../utils');
const stripe = require('../stripe');

const Mutations = {
  async createItem(parent, args, ctx, info) {
    if (!ctx.request.userId) {
      throw new Error('You must be logged in to do that.')
    }

    const item = await ctx.db.mutation.createItem(
      {
        data: {
          user: {
            // This is how we create a relationship btw user and item
            connect: {
              id: ctx.request.userId
            },
          },
          ...args,
        },
      },
      info
    );
    return item;
  },
  updateItem(parent, args, ctx, info) {
    // first take a copy of the updates
    const updates = { ...args };
    // remove the ID from the updates
    delete updates.id;
    // run the update method
    return ctx.db.mutation.updateItem(
      {
        data: updates,
        where: {
          id: args.id,
        },
      },
      info
    );
  },
  async deleteItem(parent, args, ctx, info) {
    const where = { id: args.id };
    // 1. find the item
    const item = await ctx.db.query.item({ where }, `{ id title user { id }}`);
    // 2. Check if they own that item, or have the permissions
    const ownsItem = item.user.id === ctx.request.userId;
    const hasPermissions = ctx.request.user.permissions.some(permission => ['ADMIN', 'ITEMDELETE'].includes(permission));
    if (!ownsItem && !hasPermission) {
      throw new Error("You don't have permissions to do that.")
    }
    // 3. Delete it!
    return ctx.db.mutation.deleteItem({ where }, info);
  },
  async signup(parent, args, ctx, info) {
    // lowercase their email
    args.email = args.email.toLowerCase();
    // hash their password
    const password = await bcrypt.hash(args.password, 10);
    // create the user in the database
    const user = await ctx.db.mutation.createUser(
      {
        data: {
          ...args,
          password,
          permissions: { set: ['USER', 'ADMIN'] },
        },
      },
      info
    );
    // create the JWT token for them
    const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
    // We set the jwt as a cookie on the response
    ctx.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year cookie
    });
    // Finalllllly we return the user to the browser
    return user;
  },
  async signin(parent, { email, password }, ctx, info) {
    // 1. check if there is a user with that email
    const user = await ctx.db.query.user({ where: { email } }, info);
    if (!user) {
      throw new Error(`No such user found for email ${email}`);
    }
    // 2. Check if their password is correct
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new Error('Invalid Password!');
    }
    // 3. generate the JWT Token
    const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
    // 4. Set the cookie with the token
    ctx.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
    // 5. Return the user
    return user;
  },
  signout(parent, args, ctx, info) {
    ctx.response.clearCookie('token');
    return { message: 'Goodbye!' };
  },
  async requestReset(parent, args, ctx, info) {
    // 1. Check if this is a real user
    const user = await ctx.db.query.user({ where: { email: args.email } });
    if (!user) {
      throw new Error(`No such user found for email ${args.email}`);
    }
    // 2. Set a reset token and expiry on that user
    const randomBytesPromiseified = promisify(randomBytes);
    const resetToken = (await randomBytesPromiseified(20)).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now
    const res = await ctx.db.mutation.updateUser({
      where: { email: args.email },
      data: { resetToken, resetTokenExpiry },
    });
    // 3. Email them that reset token
    const mailRes = await transport.sendMail({
      from: 'wes@wesbos.com',
      to: user.email,
      subject: 'Your Password Reset Token',
      html: makeANiceEmail(`Your Password Reset Token is here!
      \n\n
      <a href="${process.env.FRONTEND_URL}/reset?resetToken=${resetToken}">Click Here to Reset</a>`),
    });

    return { message: 'Thanks!' };
  },
  async resetPassword(parent, args, ctx, info) {
    // 1. Check if passwords match
    if (args.password != args.confirmPassword) {
      throw new Error('Passwords don\'t match');
    }
    // 2. Check if legit reset token
    // 3. Check if expired
    const [user] = await ctx.db.query.users({ where: {
      resetToken: args.resetToken,
      resetTokenExpiry_gte: Date.now() - 3600000,
    } });
    if (!user) {
      throw new Error('Token invalid or expired');
    }
    // 4. Hash new password
    const password = await bcrypt.hash(args.password, 10);
    // 5. Save new password to user
    // 6. Remove old reset token fields
    const updatedUser = await ctx.db.mutation.updateUser(
      {
        data: {
          password,
          resetToken: null,
          resetTokenExpiry: null,
        },
        where: {email: user.email},
      },
      info
    );

    // 7. Generate JWT
    const token = jwt.sign({ userId: updatedUser.id }, process.env.APP_SECRET);
    // 8. Set JWT Cookie
    ctx.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
    // 9. Return new user
    return updatedUser;
    // 10. Have a beer!
  },
  async updatePermissions(parent, args, ctx, info) {
    // Check if logged in
    const userId = ctx.request.userId;
    if (!userId) {
      throw new Error('You must be logged in to do that.');
    }
    // Query current user
    const currentUser = await ctx.db.query.user({ where: { id: userId } }, info);
    // Check if they have permissions
    hasPermission(currentUser, ['ADMIN', 'PERMISSIONUPDATE']);
    // Update Permissions
    return ctx.db.mutation.updateUser({
      data: {
        permissions: {set: args.permissions}
      },
      where: {id: args.userId}
    }, info);
  },
  async addToCart(parent, args, ctx, info) {
    // 1. Check for signed in
    const userId = ctx.request.userId;
    if (!userId) {
      throw new Error('You must be logged in to do that.');
    }
    // 2. Query the users current cart
    const [existingCartItem] = await ctx.db.query.cartItems({
      where: {
        user: { id: userId },
        item: { id: args.id },
      }
    }, info);

    // 3. Check if item already in cart, increment by 1 if it is
    if (existingCartItem) {
      return ctx.db.mutation.updateCartItem({
        where: { id: existingCartItem.id },
        data: { quantity: existingCartItem.quantity + 1 },
      }, info);
    }
    // 4. If not create cart item
    return ctx.db.mutation.createCartItem({
      data: {
        user: {
          connect: { id: userId }
        },
        item: {
          connect: { id: args.id }
        },
      },
    }, info);
  },
  async removeFromCart(parent, args, ctx, info) {
    // 1. Find the cart item
    const cartItem = await ctx.db.query.cartItem(
      {
        where: {
          id: args.id,
        },
      },
      `{ id, user { id }}`
    );
    // 1.5 Make sure we found an item
    if (!cartItem) throw new Error('No CartItem Found!');
    // 2. Make sure they own that cart item
    if (cartItem.user.id !== ctx.request.userId) {
      throw new Error('Cheatin huhhhh');
    }
    // 3. Delete that cart item
    return ctx.db.mutation.deleteCartItem(
      {
        where: { id: args.id },
      },
      info
    );
  },
  async createOrder(parent, args, ctx, info) {
    // 1. Query the current user and make sure they are signed in
    const { userId } = ctx.request;
    if (!userId) throw new Error('You must be signed in to complete this order.');
    const user = await ctx.db.query.user(
      { where: { id: userId } },
      `{
      id
      name
      email
      cart {
        id
        quantity
        item { title price id description image largeImage }
      }}`
    );
    // 2. recalculate the total for the price
    const amount = user.cart.reduce(
      (tally, cartItem) => tally + cartItem.item.price * cartItem.quantity,
      0
    );
    console.log(`Going to charge for a total of ${amount}`);
    // 3. Create the stripe charge (turn token into $$$)
    const charge = await stripe.charges.create({
      amount,
      currency: 'USD',
      source: args.token,
    });
    // 4. Convert the CartItems to OrderItems
    const orderItems = user.cart.map(cartItem => {
      const orderItem = {
        ...cartItem.item,
        quantity: cartItem.quantity,
        user: { connect: { id: userId }},
      }
      delete orderItem.id;
      return orderItem;
    });
    // 5. create the Order
    const order = await ctx.db.mutation.createOrder({
      data: {
        total: charge.amount,
        charge: charge.id,
        items: { create: orderItems },
        user: { connect: { id: userId } },
      },
    });
    // 6. Clean up - clear the users cart, delete cartItems
    const cartItemIds = user.cart.map(cartItem => cartItem.id);
    await ctx.db.mutation.deleteManyCartItems({
      where: {
        id_in: cartItemIds,
      },
    });
    // 7. Return the Order to the client
    return order;
  },
};

module.exports = Mutations;
