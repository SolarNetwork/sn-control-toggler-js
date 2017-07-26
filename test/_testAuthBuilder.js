import { AuthorizationV2Builder } from 'solarnetwork-api-core';

/**
 * An extension of `AuthorizationV2Builder` to help with testing.
 */
class TestAuthorizationV2Builder extends AuthorizationV2Builder {

    /**
     * Set the fixed authorization request date.
     *
     * <p>This date will be used even when the `date()` function is called.
     * 
     * @type {Date} the fixed date to use
     */
    get fixedDate() {
        return this._fixedDate;
    }

    set fixedDate(val) {
        const d = (val instanceof Date ? val : new Date());
        this._fixedDate = d;
        super.date(d);
    }

    get signingKeyValid() {
        return (this.signingKey ? true : false);
    }

    /**
     * Set the authorization request date.
     *
     * @inheritdoc
     * @override
     */
    date(val) {
        return super.date(this.fixedDate || val);
    }

}

export default TestAuthorizationV2Builder;
