// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract MockERC1155 is ERC1155 {
    mapping(uint256 => uint256) public supply;

    constructor() ERC1155("Mock ERC1155") {}

    function mint(address to, uint256 id, uint256 amount) external {
        _increment(id, amount);
        _mint(to, id, amount, "");
    }

    function _increment(uint256 id, uint256 amount) internal {
        supply[id] += amount;
    }
}