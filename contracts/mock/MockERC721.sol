// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockERC721 is ERC721 {
    uint256 public supply;

    constructor() ERC721("Mock ERC721", "MOCK") {}

    function mint(address to) external {
        _increment();
        uint256 tokenId = supply;
        _safeMint(to, tokenId);
    }

    function _increment() internal {
        supply++;
    }
}